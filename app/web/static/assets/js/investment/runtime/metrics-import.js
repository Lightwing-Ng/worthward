/**
 * Metrics rendering and import request lifecycle.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentMetricsImportRuntime(runtime) {
function setInvestmentHoverContainerPayload(container, payload = null) {
        if (!(container instanceof HTMLElement)) return;
        if (!payload || typeof payload !== 'object') {
            delete container.dataset.investmentHoverPayload;
            return;
        }
        const normalizedPayload = {
            hoverTicker: runtime.normalizeInvestmentTicker(payload.hoverTicker || ''),
            hoverLedgerNo: Number.isFinite(Number(payload.hoverLedgerNo)) && Number(payload.hoverLedgerNo) > 0
                ? Number(payload.hoverLedgerNo)
                : 0,
            historyLedgerNos: runtime.normalizeInvestmentLedgerNos(payload.historyLedgerNos),
            stockDetailLedgerNos: runtime.normalizeInvestmentLedgerNos(payload.stockDetailLedgerNos),
            interactionLedgerNo: Number.isFinite(Number(payload.interactionLedgerNo)) && Number(payload.interactionLedgerNo) > 0
                ? Number(payload.interactionLedgerNo)
                : 0,
            historyBehavior: payload.historyBehavior === 'smooth' ? 'smooth' : 'auto',
            historyScroll: Boolean(payload.historyScroll),
            stockDetailBehavior: payload.stockDetailBehavior === 'smooth' ? 'smooth' : 'auto',
            stockDetailScroll: Boolean(payload.stockDetailScroll),
        };
        container.dataset.investmentHoverPayload = JSON.stringify(normalizedPayload);
    }

function getInvestmentHoverContainerPayload(container) {
        if (!(container instanceof HTMLElement)) return null;
        const rawPayload = String(container.dataset.investmentHoverPayload || '').trim();
        if (!rawPayload) return null;
        try {
            const payload = JSON.parse(rawPayload);
            return {
                hoverTicker: runtime.normalizeInvestmentTicker(payload?.hoverTicker || ''),
                hoverLedgerNo: Number(payload?.hoverLedgerNo) || 0,
                historyLedgerNos: runtime.normalizeInvestmentLedgerNos(payload?.historyLedgerNos),
                stockDetailLedgerNos: runtime.normalizeInvestmentLedgerNos(payload?.stockDetailLedgerNos),
                interactionLedgerNo: Number(payload?.interactionLedgerNo) || 0,
                historyBehavior: payload?.historyBehavior === 'smooth' ? 'smooth' : 'auto',
                historyScroll: Boolean(payload?.historyScroll),
                stockDetailBehavior: payload?.stockDetailBehavior === 'smooth' ? 'smooth' : 'auto',
                stockDetailScroll: Boolean(payload?.stockDetailScroll),
            };
        } catch (error) {
            delete container.dataset.investmentHoverPayload;
            return null;
        }
    }

function clearInvestmentChartLinkedHoverState() {
        runtime.syncHoldingsChartHoverState('', 0);
        runtime.clearInvestmentStockDetailHighlights();
        runtime.clearInvestmentHistoryHighlights();
    }

function bindInvestmentHoverContainerPersistence(container) {
        if (!(container instanceof HTMLElement) || container.dataset.investmentHoverContainerBound === '1') return;
        container.dataset.investmentHoverContainerBound = '1';
        container.addEventListener('mouseenter', () => {
            const payload = getInvestmentHoverContainerPayload(container);
            if (!payload) return;
            runtime.syncInvestmentHoverLinkedViews(payload);
        });
        container.addEventListener('mouseleave', () => {
            clearInvestmentChartLinkedHoverState();
        });
    }

function renderInvestmentMetricBreakdownCard(definition, metricValues, { keyPrefix = '' } = {}) {
        const metricLabel = String(definition?.label || 'Metric');
        const metricKey = keyPrefix ? `${keyPrefix}-${definition?.key || 'metric'}` : (definition?.key || 'metric');
        const breakdownId = `investment_metric_breakdown_${String(metricKey).replace(/[^a-z0-9_-]/gi, '_')}`;
        const pnlUnavailable = metricValues?.pnlUnavailable === true && /pnl/i.test(String(definition?.key || ''));
        const details = !pnlUnavailable && Array.isArray(metricValues?.[definition?.detailsKey])
            ? metricValues[definition.detailsKey]
            : [];
        const hasBreakdown = details.length > 0;
        const value = pnlUnavailable
            ? (metricValues?.pnlCoverage?.status === 'partial' ? 'Partial · total unavailable' : 'Unavailable')
            : (definition?.formatValue
            ? definition.formatValue(metricValues)
            : runtime.formatAmount(metricValues?.[definition?.valueKey]));
        const valueClass = pnlUnavailable
            ? ''
            : (typeof definition?.valueClass === 'function'
            ? definition.valueClass(metricValues)
            : (definition?.valueClass || ''));
        const liveNumber = definition?.liveNumberKey
            ? metricValues?.[definition.liveNumberKey]
            : metricValues?.[definition?.valueKey];
        const valueMarkup = definition?.liveField && !pnlUnavailable
            ? runtime.renderInvestmentLiveValue(definition.liveField, liveNumber, {
                className: `trade-metric-value investment-stock-details-metric-value${valueClass ? ` ${valueClass}` : ''}`,
                formatter: () => value,
                useSplitValue: true,
            })
            : `
                <span class="trade-metric-value investment-stock-details-metric-value${valueClass ? ` ${valueClass}` : ''}"
                      data-workspace-mask="trade-metric">${runtime.renderWorkspaceMetricValueContent(value)}</span>
            `;
        const valueRowMarkup = hasBreakdown
            ? `
                <div class="investment-metric-value-row">
                    <button type="button"
                            class="investment-stock-details-metric-breakdown-trigger"
                            data-investment-metric-breakdown-trigger
                            data-investment-metric-label="${runtime.escapeHtml(metricLabel)}"
                            aria-controls="${breakdownId}"
                            aria-expanded="false"
                            aria-label="Show ${runtime.escapeHtml(metricLabel)} details"></button>
                    ${valueMarkup}
                </div>
            `
            : valueMarkup;
        const breakdownMarkup = hasBreakdown
            ? `
                <div id="${breakdownId}"
                     class="investment-stock-details-metric-breakdown"
                     role="region"
                     aria-label="${runtime.escapeHtml(metricLabel)} details"
                     hidden>
                    ${details.map((detail) => `
                        <div class="investment-stock-details-metric-breakdown-row">
                            <span class="investment-stock-details-metric-breakdown-label">${runtime.escapeHtml(detail?.label || '')}</span>
                            <span class="investment-stock-details-metric-breakdown-value${detail?.valueClass ? ` ${detail.valueClass}` : ''}"
                                  data-workspace-mask="trade-metric">${runtime.renderWorkspaceMetricValueContent(detail?.value || '--')}</span>
                        </div>
                    `).join('')}
                </div>
            `
            : '';

        return `
            <div class="trade-metric-card trade-metric-card--value-align-end${hasBreakdown ? ' investment-metric-card-with-breakdown' : ''}"
                 data-metric-key="${runtime.escapeHtml(metricKey)}">
                <span class="trade-metric-label">${runtime.escapeHtml(metricLabel)}</span>
                ${valueRowMarkup}
                ${breakdownMarkup}
            </div>
        `;
    }

function renderMetricCards(metricDefinitions, metricValues, { keyPrefix = '' } = {}) {
        return metricDefinitions.map((definition) => {
            if (definition?.renderMode === 'breakdown') {
                return renderInvestmentMetricBreakdownCard(definition, metricValues, { keyPrefix });
            }
            const pnlUnavailable = metricValues?.pnlUnavailable === true && /pnl/i.test(String(definition?.key || ''));
            return `
                <div class="trade-metric-card trade-metric-card--value-align-end">
                    <span class="trade-metric-label">${definition.label}</span>
                    ${runtime.renderMetricValueWithTooltip({
                        key: definition.key,
                        value: pnlUnavailable
                            ? (metricValues?.pnlCoverage?.status === 'partial' ? 'Partial · total unavailable' : 'Unavailable')
                            : (definition.formatValue
                            ? definition.formatValue(metricValues)
                            : runtime.formatAmount(metricValues?.[definition.valueKey])),
                        valueClass: pnlUnavailable
                            ? ''
                            : (typeof definition.valueClass === 'function'
                            ? definition.valueClass(metricValues)
                            : (definition.valueClass || '')),
                        summary: definition.summary,
                        rows: pnlUnavailable ? [] : metricValues?.[definition.rowsKey],
                        liveField: pnlUnavailable ? '' : definition.liveField,
                        liveNumber: pnlUnavailable ? null : (definition.liveNumberKey
                            ? metricValues?.[definition.liveNumberKey]
                            : metricValues?.[definition.valueKey]),
                    }, { keyPrefix })}
                </div>
            `;
        }).join('');
    }

function getBrokerRewardRealizedIncome(brokerBenefitMetrics) {
        return (
            Number(brokerBenefitMetrics?.couponRebateIncome ?? 0)
            + Number(brokerBenefitMetrics?.cashRewardIncome ?? 0)
            + Number(brokerBenefitMetrics?.kolRewardIncome ?? 0)
        );
    }

function getBrokerRewardLedgerRows(brokerBenefitMetrics) {
        return Array.from(new Set([
            ...(Array.isArray(brokerBenefitMetrics?.couponRebateHkdRows) ? brokerBenefitMetrics.couponRebateHkdRows : []),
            ...(Array.isArray(brokerBenefitMetrics?.couponRebateUsdRows) ? brokerBenefitMetrics.couponRebateUsdRows : []),
            ...(Array.isArray(brokerBenefitMetrics?.cashRewardHkdRows) ? brokerBenefitMetrics.cashRewardHkdRows : []),
            ...(Array.isArray(brokerBenefitMetrics?.cashRewardUsdRows) ? brokerBenefitMetrics.cashRewardUsdRows : []),
            ...(Array.isArray(brokerBenefitMetrics?.kolRewardRows) ? brokerBenefitMetrics.kolRewardRows : []),
        ]));
    }

function renderFundingMetricCards(
        fundingMetrics,
        holdingsSummaryMetrics,
        brokerBenefitMetrics,
        { keyPrefix = '' } = {},
    ) {
        return [
            renderMetricCards(runtime.HOLDINGS_SUMMARY_METRIC_DEFINITIONS, holdingsSummaryMetrics, { keyPrefix }),
            renderMetricCards(runtime.FUNDING_METRIC_DEFINITIONS, fundingMetrics, { keyPrefix }),
            renderMetricCards(runtime.BROKER_BENEFIT_METRIC_DEFINITIONS, brokerBenefitMetrics, { keyPrefix }),
        ].join('');
    }

function mapInvestmentMetricRowsToGlobalLedgerNos(metricValues, scopedTransactions) {
        if (!metricValues || typeof metricValues !== 'object') return metricValues;
        const globalEntries = runtime.getSortedInvestmentMetricTransactions(runtime.state.investmentRawTransactionsCache);
        const globalLedgerNoByTransaction = new Map(
            globalEntries.map(({txn, ledgerNo}) => [txn, ledgerNo]),
        );
        const scopedEntries = runtime.getSortedInvestmentMetricTransactions(scopedTransactions);
        const scopedLedgerNoToGlobal = new Map(
            scopedEntries.map(({txn, ledgerNo}) => [ledgerNo, globalLedgerNoByTransaction.get(txn)]),
        );
        return Object.fromEntries(Object.entries(metricValues).map(([key, value]) => {
            if (!key.endsWith('Rows') || !Array.isArray(value)) return [key, value];
            return [key, value.map((rowNo) => scopedLedgerNoToGlobal.get(Number(rowNo)) ?? rowNo)];
        }));
    }

function getInvestmentBrokerSummaryTransactions(brokerCode = runtime.getInvestmentBrokerSummarySelectedCode()) {
        const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
        if (normalizedBrokerCode === 'all') {
            return runtime.getInvestmentAggregateOnlyTransactions(runtime.state.investmentRawTransactionsCache);
        }
        if (!normalizedBrokerCode) return [];
        return runtime.state.investmentRawTransactionsCache.filter((txn) => (
            runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === normalizedBrokerCode
        ));
    }

function getInvestmentBrokerSummaryTotalEquity(brokerCode) {
        const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
        if (!normalizedBrokerCode) return 0;
        const latestProcessed = [...runtime.state.investmentProcessedTransactionsCache].reverse().find((txn) => (
            runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === normalizedBrokerCode
        ));
        const brokerTotalEquity = Number(latestProcessed?.broker_total_equity);
        return Number.isFinite(brokerTotalEquity) ? brokerTotalEquity : 0;
    }

function resolveInvestmentMetricsCurrentCash(transactions, brokerCode = 'all', currentCash = null) {
        const normalizedBrokerCode = runtime.normalizeInvestmentBroker(brokerCode);
        const isAllBrokers = !normalizedBrokerCode || normalizedBrokerCode === 'all';
        const cashKeys = isAllBrokers
            ? ['aggregate_display_cash', 'aggregate_current_display_cash', 'aggregate_running_cash', 'running_cash']
            : ['broker_display_cash', 'broker_running_cash'];
        const readLatestCash = (sourceTransactions) => {
            const source = Array.isArray(sourceTransactions) ? sourceTransactions : [];
            for (let index = source.length - 1; index >= 0; index -= 1) {
                const transaction = source[index];
                for (const key of cashKeys) {
                    if (!Object.prototype.hasOwnProperty.call(transaction || {}, key)) continue;
                    const value = runtime.getOptionalInvestmentNumber(transaction?.[key]);
                    if (value === null) return {cash: null, cashIsApproximate: false};
                    if (value !== null) {
                        return {
                            cash: value,
                            cashIsApproximate: isAllBrokers
                                ? transaction?.aggregate_current_cash_is_approximate === true
                                : transaction?.broker_current_cash_is_approximate === true,
                        };
                    }
                }
            }
            return null;
        };

        if (Number.isNaN(currentCash)) return {cash: null, cashIsApproximate: false};
        const explicitCurrentCash = runtime.getOptionalInvestmentNumber(currentCash);
        if (explicitCurrentCash !== null) {
            const latestProcessed = runtime.state.investmentProcessedTransactionsCache[
                runtime.state.investmentProcessedTransactionsCache.length - 1
            ];
            return {
                cash: explicitCurrentCash,
                cashIsApproximate: latestProcessed?.aggregate_current_cash_is_approximate === true,
            };
        }

        if (!isAllBrokers) {
            const baseCurrency = runtime.getInvestmentBaseCurrency();
            const fxTransactions = Array.isArray(runtime.state.investmentRawTransactionsCache)
                && runtime.state.investmentRawTransactionsCache.length
                ? runtime.state.investmentRawTransactionsCache
                : transactions;
            const currentBrokerSnapshot = runtime.getInvestmentBrokerCurrentCashSnapshot(
                normalizedBrokerCode,
                runtime.getTodayLedgerDate(),
                runtime.buildInvestmentFxRateTimeline(fxTransactions, baseCurrency),
            );
            if (currentBrokerSnapshot) {
                return {
                    cash: currentBrokerSnapshot.displayCash,
                    cashIsApproximate: currentBrokerSnapshot.isApproximate === true,
                };
            }
        } else {
            const realtimeState = runtime.getInvestmentHoldingsRealtimeState();
            const realtimeCash = runtime.getOptionalInvestmentNumber(realtimeState?.aggregateCash);
            if (realtimeCash !== null) {
                return {
                    cash: realtimeCash,
                    cashIsApproximate: realtimeState?.cashIsApproximate === true,
                };
            }
        }

        const processedTransactions = Array.isArray(runtime.state.investmentProcessedTransactionsCache)
            ? runtime.state.investmentProcessedTransactionsCache
            : [];
        const scopedProcessedTransactions = isAllBrokers
            ? runtime.getInvestmentAggregateOnlyTransactions(processedTransactions)
            : processedTransactions.filter((transaction) => (
                runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(transaction)) === normalizedBrokerCode
            ));
        return readLatestCash(scopedProcessedTransactions)
            ?? readLatestCash(transactions)
            ?? {cash: null, cashIsApproximate: false};
    }

function renderInvestmentMetricsPanel({
        fundingMetrics = null,
        holdingsSummaryMetrics = null,
        brokerBenefitMetrics = null,
        totalEquity = null,
        latestPrices = null,
    } = {}) {
        runtime.mountInvestmentBrokerSummarySelector();
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!(metricsPanel instanceof HTMLElement)) return;

        const selectedBrokerCode = runtime.getInvestmentBrokerSummarySelectedCode();
        const isAllBrokersSelected = selectedBrokerCode === 'all';
        if (isAllBrokersSelected && runtime.state.investmentAggregateSecurityTransferState.blocked) {
            runtime.removeInvestmentMetricTooltips();
            metricsPanel.innerHTML = `
                <div class="investment-holdings-table-shell">
                    <div class="investment-holdings-empty">${runtime.escapeHtml(runtime.getInvestmentAggregateSecurityTransferBlockedMessage())}</div>
                </div>
            `;
            return;
        }
        const scopedTransactions = getInvestmentBrokerSummaryTransactions(selectedBrokerCode);
        const mergedLatestPrices = {
            ...(runtime.state.investmentBaseLatestPricesCache && typeof runtime.state.investmentBaseLatestPricesCache === 'object'
                ? runtime.state.investmentBaseLatestPricesCache
                : {}),
            ...(runtime.state.investmentLatestPricesCache && typeof runtime.state.investmentLatestPricesCache === 'object'
                ? runtime.state.investmentLatestPricesCache
                : {}),
            ...(latestPrices && typeof latestPrices === 'object' ? latestPrices : {}),
        };
        const resolvedTotalEquity = isAllBrokersSelected && Number.isFinite(Number(totalEquity))
            ? Number(totalEquity)
            : isAllBrokersSelected
                ? runtime.getLatestDashboardEquity(runtime.state.investmentProcessedTransactionsCache, runtime.state.investmentChartPointsCache)
                : getInvestmentBrokerSummaryTotalEquity(selectedBrokerCode);
        const resolvedBrokerBenefitMetrics = isAllBrokersSelected && brokerBenefitMetrics
            ? brokerBenefitMetrics
            : runtime.getBrokerBenefitMetrics(scopedTransactions, mergedLatestPrices, resolvedTotalEquity);
        const resolvedHoldingsSummaryMetrics = isAllBrokersSelected && holdingsSummaryMetrics
            ? holdingsSummaryMetrics
            : runtime.getHoldingsSummaryMetrics(
                scopedTransactions,
                mergedLatestPrices,
                resolvedTotalEquity,
                resolvedBrokerBenefitMetrics,
                { brokerCode: selectedBrokerCode },
            );
        const resolvedFundingMetrics = isAllBrokersSelected && fundingMetrics
            ? fundingMetrics
            : runtime.getUsdFundingMetrics(scopedTransactions);
        const metricsToRender = isAllBrokersSelected
            ? [resolvedFundingMetrics, resolvedHoldingsSummaryMetrics, resolvedBrokerBenefitMetrics]
            : [
                mapInvestmentMetricRowsToGlobalLedgerNos(resolvedFundingMetrics, scopedTransactions),
                mapInvestmentMetricRowsToGlobalLedgerNos(resolvedHoldingsSummaryMetrics, scopedTransactions),
                mapInvestmentMetricRowsToGlobalLedgerNos(resolvedBrokerBenefitMetrics, scopedTransactions),
            ];
        runtime.removeInvestmentMetricTooltips();
        metricsPanel.innerHTML = renderFundingMetricCards(
            metricsToRender[0],
            metricsToRender[1],
            metricsToRender[2],
        );
        runtime.bindInvestmentMetricBreakdownControls(metricsPanel);
        runtime.bindInvestmentMetricTooltipInteractions(metricsPanel);
    }

function resetInvestmentDashboard() {
        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        const stockDetailsPanel = document.getElementById(runtime.INVESTMENT_STOCK_DETAILS_PANEL_ID);
        const chartContainer = document.getElementById('investment_equity_chart');

        runtime.state.selectedInvestmentStockTicker = '';
        runtime.state.investmentRawTransactionsCache = [];
        runtime.state.investmentProcessedTransactionsCache = [];
        runtime.state.investmentReplaySnapshotsCache = [];
        runtime.state.investmentTickerSummariesCache = [];
        runtime.state.investmentBrokerSummarySelectedCode = 'all';
        runtime.state.investmentBrokerSummarySelectionInitialized = false;
        runtime.state.investmentBrokerFilterSelectedCodes = new Set();
        runtime.refreshInvestmentAvailableBrokerCodes();
        runtime.clearInvestmentStockDetailHighlights();
        if (holdingsPanel) {
            holdingsPanel.innerHTML = runtime.renderHoldingsTable([], {}, 0);
        }
        if (metricsPanel) renderInvestmentMetricsPanel();
        if (stockDetailsPanel) {
            stockDetailsPanel.innerHTML = `
                <div class="investment-stock-details-empty-shell">
                    <p class="investment-holdings-empty">Open Holdings or import transactions, then pick a ticker to inspect its stock details.</p>
                </div>
            `;
        }
        if (runtime.investmentStockDetailsTableHost instanceof HTMLElement) {
            runtime.investmentStockDetailsTableHost.innerHTML = '';
            runtime.syncInvestmentStockDetailsTableVisibility();
        }
        if (chartContainer) {
            chartContainer.innerHTML = '';
        }
    }

function syncImportValidationState() {
        const transactionFile = runtime.transactionsCsvInput?.files?.[0];
        const positionsFile = runtime.positionsCsvInput?.files?.[0];
        const selectedBroker = runtime.getSelectedInvestmentImportBroker();
        const isIbkr = selectedBroker === 'ibkr';
        const ibkrImportMode = runtime.getSelectedIbkrImportMode();
        const isIbkrCsv = isIbkr && ibkrImportMode === 'csv';
        const isIbkrGainskeeper = isIbkr && ibkrImportMode === 'gainskeeper';
        const isIbkrWebPaste = isIbkr && ibkrImportMode === 'web_paste';
        const isLongbridgeHk = selectedBroker === 'longbridge_hk';
        const isLongbridgeSg = selectedBroker === 'longbridge_sg';
        const isFutuhk = selectedBroker === 'futuhk';
        const isBocHk = selectedBroker === 'boc_hk';
        const isHsbc = selectedBroker === 'hsbc';
        const hsbcImportMode = runtime.getSelectedHsbcImportMode();
        const isHsbcPaste = isHsbc && hsbcImportMode === 'paste';
        const isHsbcStatementPdf = isHsbc && hsbcImportMode === 'statement_pdf';
        const isSchwab = selectedBroker === 'schwab';
        const isTigertrade = selectedBroker === 'tigertrade';
        const isUsmartHk = selectedBroker === 'usmart_hk';
        const usesStandardXlsxImport = runtime.GENERIC_XLSX_INVESTMENT_BROKERS.has(selectedBroker);
        const futuhkStatementFiles = runtime.getSelectedFutuStatementPdfFiles();
        const bocHkStatementFiles = runtime.getSelectedStatementPdfFiles(runtime.bocHkStatementPdfsInput);
        const hsbcStatementFiles = runtime.getSelectedStatementPdfFiles(runtime.hsbcStatementPdfsInput);
        const tigertradeStatementFiles = runtime.getSelectedStatementPdfFiles(runtime.tigertradeStatementPdfsInput);
        const usmartHkStatementFiles = runtime.getSelectedStatementPdfFiles(runtime.usmartHkStatementPdfsInput);
        const longbridgeSgFundDetailsFile = runtime.longbridgeSgFundDetailsInput?.files?.[0];
        const longbridgeSgHistoryOrdersFile = runtime.longbridgeSgHistoryOrdersInput?.files?.[0];
        const transactionReady = isIbkrCsv ? runtime.isLikelyTransactionHistoryFile(transactionFile) : false;
        const positionsReady = isIbkrCsv ? runtime.isLikelyPositionsFile(positionsFile) : false;
        const gainskeeperFiles = runtime.gainskeeperFilesInput?.files ? Array.from(runtime.gainskeeperFilesInput.files) : [];
        const gainskeeperReady = isIbkrGainskeeper
            && gainskeeperFiles.length > 0
            && gainskeeperFiles.every((file) => runtime.isLikelyGainskeeperFile(file));
        const ibkrTradeNotificationsText = String(
            runtime.ibkrTradeNotificationsTextInput?.value || ''
        ).trim();
        const ibkrTradeNotificationsReady = isIbkrWebPaste
            && runtime.isLikelyIbkrTradeNotificationsText(ibkrTradeNotificationsText);
        const ibkrHoldingsText = String(runtime.ibkrHoldingsTextInput?.value || '').trim();
        const ibkrHoldingsReady = !ibkrHoldingsText
            || runtime.getIbkrHoldingsReadiness(ibkrHoldingsText).ready;
        const hsbcPortfolioText = String(runtime.hsbcPortfolioTextInput?.value || '').trim();
        const hsbcOrderStatusText = String(runtime.hsbcOrderStatusTextInput?.value || '').trim();
        const hsbcCashAccountText = String(runtime.hsbcCashAccountTextInput?.value || '').trim();
        const hsbcPasteSignature = runtime.getHsbcPasteValidationSignature({
            cash: hsbcCashAccountText,
            portfolio: hsbcPortfolioText,
            order_status: hsbcOrderStatusText,
        });
        const longbridgeHkFundDetailsFile = runtime.longbridgeHkFundDetailsInput?.files?.[0];
        const longbridgeHkHistoryOrdersFile = runtime.longbridgeHkHistoryOrdersInput?.files?.[0];
        const longbridgeHkFilesReady = isLongbridgeHk && runtime.isLikelyLongbridgeSgFundDetailsFile(longbridgeHkFundDetailsFile) && runtime.isLikelyLongbridgeSgHistoryOrdersFile(longbridgeHkHistoryOrdersFile);
        const longbridgeSgFundDetailsReady = isLongbridgeSg && runtime.isLikelyLongbridgeSgFundDetailsFile(longbridgeSgFundDetailsFile);
        const longbridgeSgHistoryOrdersReady = isLongbridgeSg && runtime.isLikelyLongbridgeSgHistoryOrdersFile(longbridgeSgHistoryOrdersFile);
        const hsbcPortfolioValidationState = isHsbcPaste
            ? runtime.getHsbcPasteFieldValidationState('portfolio', hsbcPortfolioText)
            : 'empty';
        const hsbcOrderStatusValidationState = isHsbcPaste
            ? runtime.getHsbcPasteFieldValidationState('order', hsbcOrderStatusText)
            : 'empty';
        const hsbcCashAccountValidationState = isHsbcPaste
            ? runtime.getHsbcPasteFieldValidationState('cash', hsbcCashAccountText)
            : 'empty';
        const hsbcPasteReady = isHsbcPaste
            && runtime.state.hsbcPasteValidation.signature === hsbcPasteSignature
            && runtime.state.hsbcPasteValidation.state === 'valid'
            && runtime.state.hsbcPasteValidation.ready;
        const hsbcStatementsReady = isHsbcStatementPdf
            && runtime.isCompleteHsbcStatementPdfBundle(hsbcStatementFiles, runtime.isLikelyPdfFile);
        const futuhkStatementsReady = isFutuhk
            && futuhkStatementFiles.length > 0
            && futuhkStatementFiles.every((file) => runtime.isLikelyFutuStatementPdf(file));
        const bocHkStatementsReady = isBocHk
            && bocHkStatementFiles.length > 0
            && bocHkStatementFiles.every((file) => runtime.isLikelyBocHkStatementPdf(file));
        const schwabTransactionsFile = runtime.schwabTransactionsCsvInput?.files?.[0];
        const schwabPositionsFile = runtime.schwabPositionsCsvInput?.files?.[0];
        const schwabTransactionsReady = isSchwab && runtime.isLikelyCsvFile(schwabTransactionsFile);
        const schwabPositionsReady = isSchwab && runtime.isLikelyCsvFile(schwabPositionsFile);
        const schwabReady = schwabTransactionsReady && schwabPositionsReady;
        const tigertradeStatementsReady = isTigertrade
            && tigertradeStatementFiles.length > 0
            && tigertradeStatementFiles.every((file) => runtime.isLikelyPdfFile(file));
        const usmartHkStatementsReady = isUsmartHk
            && usmartHkStatementFiles.length > 0
            && usmartHkStatementFiles.every((file) => runtime.isLikelyPdfFile(file));
        const zirconHkWorkbookFile = runtime.zirconHkTransactionsXlsxInput?.files?.[0];
        const zirconHkWorkbookReady = usesStandardXlsxImport
            && runtime.isLikelyXlsxFile(zirconHkWorkbookFile)
            && runtime.state.zirconHkWorkbookValidation.valid
            && runtime.state.zirconHkWorkbookValidation.signature === runtime.getImportFileSignature(zirconHkWorkbookFile);
        const brokerReady = runtime.SUPPORTED_INVESTMENT_IMPORT_BROKERS.has(selectedBroker);
        const importReady = brokerReady && (
            (isIbkrCsv && transactionReady && positionsReady)
            || gainskeeperReady
            || (ibkrTradeNotificationsReady && ibkrHoldingsReady)
            || (isLongbridgeHk && Boolean(longbridgeHkFilesReady))
            || (isLongbridgeSg && Boolean(longbridgeSgFundDetailsReady) && Boolean(longbridgeSgHistoryOrdersReady))
            || (isFutuhk && Boolean(futuhkStatementsReady))
            || (isBocHk && Boolean(bocHkStatementsReady))
            || Boolean(hsbcPasteReady)
            || (isHsbcStatementPdf && Boolean(hsbcStatementsReady))
            || (isSchwab && Boolean(schwabReady))
            || (isTigertrade && Boolean(tigertradeStatementsReady))
            || (isUsmartHk && Boolean(usmartHkStatementsReady))
            || Boolean(zirconHkWorkbookReady)
        );

        runtime.setImportStatusIcon(runtime.transactionsCsvStatus, transactionReady);
        runtime.setImportStatusIcon(runtime.positionsCsvStatus, positionsReady);
        runtime.setImportStatusIcon(runtime.gainskeeperFilesStatus, gainskeeperReady);
        runtime.setImportStatusIcon(
            runtime.ibkrTradeNotificationsTextStatus,
            Boolean(ibkrTradeNotificationsReady),
        );
        runtime.setImportStatusIcon(
            runtime.ibkrHoldingsTextStatus,
            Boolean(ibkrHoldingsText && ibkrHoldingsReady),
        );

        runtime.setImportStatusIcon(runtime.longbridgeSgFundDetailsStatus, Boolean(longbridgeSgFundDetailsReady));
        runtime.setImportStatusIcon(runtime.longbridgeSgHistoryOrdersStatus, Boolean(longbridgeSgHistoryOrdersReady));
        const longbridgeHkFundDetailsReady = !!(runtime.longbridgeHkFundDetailsInput && runtime.longbridgeHkFundDetailsInput.files && runtime.longbridgeHkFundDetailsInput.files.length > 0);
        const longbridgeHkHistoryOrdersReady = !!(runtime.longbridgeHkHistoryOrdersInput && runtime.longbridgeHkHistoryOrdersInput.files && runtime.longbridgeHkHistoryOrdersInput.files.length > 0);
        runtime.setImportStatusIcon(runtime.longbridgeHkFundDetailsStatus, longbridgeHkFundDetailsReady);
        runtime.setImportStatusIcon(runtime.longbridgeHkHistoryOrdersStatus, longbridgeHkHistoryOrdersReady);
        runtime.setHsbcPasteStatusIcon(
            runtime.hsbcPortfolioTextStatus,
            hsbcPortfolioValidationState,
            hsbcPortfolioValidationState === 'valid' ? 'HSBC Portfolio text validated.' : '',
        );
        runtime.setHsbcPasteStatusIcon(
            runtime.hsbcOrderStatusTextStatus,
            hsbcOrderStatusValidationState,
            hsbcOrderStatusValidationState === 'valid' ? 'HSBC Order Status text validated.' : '',
        );
        runtime.setHsbcPasteStatusIcon(
            runtime.hsbcCashAccountTextStatus,
            hsbcCashAccountValidationState,
            hsbcCashAccountValidationState === 'valid'
                ? `HSBC ${runtime.state.hsbcPasteValidation.cashCurrencies.join(', ') || 'cash-account'} text validated.`
                : '',
        );
        runtime.setImportStatusIcon(runtime.hsbcStatementPdfsStatus, Boolean(hsbcStatementsReady));
        runtime.setImportStatusIcon(runtime.futuhkStatementPdfsStatus, Boolean(futuhkStatementsReady));
        runtime.setImportStatusIcon(runtime.bocHkStatementPdfsStatus, Boolean(bocHkStatementsReady));
        runtime.setImportStatusIcon(runtime.schwabTransactionsCsvStatus, Boolean(schwabTransactionsReady));
        runtime.setImportStatusIcon(runtime.schwabPositionsCsvStatus, Boolean(schwabPositionsReady));
        runtime.setImportStatusIcon(runtime.tigertradeStatementPdfsStatus, Boolean(tigertradeStatementsReady));
        runtime.setImportStatusIcon(runtime.usmartHkStatementPdfsStatus, Boolean(usmartHkStatementsReady));
        runtime.setImportStatusIcon(
            runtime.zirconHkTransactionsXlsxStatus,
            Boolean(zirconHkWorkbookReady),
            zirconHkWorkbookReady
                ? `Validated ${runtime.state.zirconHkWorkbookValidation.transactionCount.toLocaleString()} standard XLSX transactions.`
                : '',
        );

        const submitButton = runtime.investmentForm?.querySelector('button[type="submit"]');
        runtime.syncActionButtonState(submitButton, {
            disabled: !importReady,
            pending: runtime.state.investmentImportInFlight,
        });
    }

function syncInvestmentImportContainerHeight() {
        if (!(runtime.formContainer instanceof HTMLElement) || runtime.formContainer.style.display === 'none') {
            return;
        }
        const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
        if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
            return;
        }
        const verticalInset = window.innerWidth <= 767 ? 16 : 32;
        const availableHeight = Math.max(240, viewportHeight - (verticalInset * 2));
        const quickActionsRect = runtime.globalQuickActions?.getBoundingClientRect();
        const configuredQuickActionsTop = Number.parseFloat(
            getComputedStyle(document.body).getPropertyValue('--investment-import-control-rail-top'),
        );
        const quickActionsTop = quickActionsRect && quickActionsRect.height > 0
            ? quickActionsRect.top
            : (Number.isFinite(configuredQuickActionsTop) ? configuredQuickActionsTop : 16);
        if (quickActionsRect && quickActionsRect.width > 0 && quickActionsRect.height > 0) {
            document.body.style.setProperty('--investment-import-control-rail-top', `${quickActionsTop}px`);
        }
        const closeButtonRect = runtime.investmentImportCloseButton?.getBoundingClientRect();
        const buttonSize = Number.parseFloat(
            getComputedStyle(document.body).getPropertyValue('--settings-round-icon-button-size'),
        ) || 36;
        const controlRailTop = closeButtonRect && closeButtonRect.height > 0
            ? closeButtonRect.top
            : quickActionsTop + buttonSize + 10;
        const alignedHeight = viewportHeight - controlRailTop - controlRailTop;
        runtime.formContainer.style.setProperty(
            '--investment-import-modal-height',
            `${Math.max(240, Math.min(availableHeight, alignedHeight))}px`,
        );
    }

function setInvestmentImportControlState({ isOpen, isClosing = false }) {
        document.body.classList.toggle('is-investment-import-modal-open', isOpen);
        if (runtime.toggleBtn instanceof HTMLButtonElement) {
            runtime.toggleBtn.disabled = isOpen;
            runtime.toggleBtn.hidden = isOpen;
            runtime.toggleBtn.setAttribute('aria-disabled', String(isOpen));
        }
        if (runtime.sidebarToggle instanceof HTMLButtonElement) {
            runtime.sidebarToggle.disabled = isOpen;
            runtime.sidebarToggle.hidden = isOpen;
            runtime.sidebarToggle.setAttribute('aria-disabled', String(isOpen));
        }
        if (runtime.sidebarDock instanceof HTMLElement) {
            runtime.sidebarDock.hidden = isOpen;
        }
        if (runtime.investmentSectionResizer instanceof HTMLButtonElement) {
            runtime.investmentSectionResizer.disabled = isOpen;
            runtime.investmentSectionResizer.setAttribute('aria-disabled', String(isOpen));
        }
        if (runtime.investmentImportCloseButton instanceof HTMLButtonElement) {
            runtime.investmentImportCloseButton.hidden = !isOpen;
            runtime.investmentImportCloseButton.disabled = !isOpen || isClosing;
        }
    }

function openInvestmentImportForm() {
        if (!runtime.toggleBtn || !runtime.formContainer) return;
        if (runtime.state.investmentFormHideTimer) {
            window.clearTimeout(runtime.state.investmentFormHideTimer);
            runtime.state.investmentFormHideTimer = null;
        }
        runtime.clearImportFeedback();
        runtime.formContainer.style.removeProperty('--investment-import-modal-height');
        runtime.formContainer.style.display = 'flex';
        runtime.formContainer.scrollTop = 0;
        setInvestmentImportControlState({ isOpen: true });
        runtime.syncInvestmentFormLayout();
        syncInvestmentImportContainerHeight();
        // Re-ensure the broker dropdown shared select is fully bound and labels synced
        // when the form becomes visible. The shared binder is idempotent; preserving
        // its bound flag avoids stacking duplicate click/change handlers.
        if (typeof window.repairSidebarControlBindings === 'function') {
            window.repairSidebarControlBindings();
        }
        if (runtime.investmentImportBrokerSelect) {
            runtime.investmentImportBrokerSelect.dispatchEvent(new Event('change', {bubbles: true}));
        }
        setTimeout(() => {
            runtime.formContainer.style.opacity = '1';
            window.setTimeout(syncInvestmentImportContainerHeight, 180);
            window.setTimeout(syncInvestmentImportContainerHeight, 360);
        }, 50);
    }

function closeInvestmentImportForm() {
        if (!runtime.toggleBtn || !runtime.formContainer) return;
        if (runtime.state.investmentFormHideTimer) {
            window.clearTimeout(runtime.state.investmentFormHideTimer);
            runtime.state.investmentFormHideTimer = null;
        }
        runtime.formContainer.style.opacity = '0';
        setInvestmentImportControlState({ isOpen: true, isClosing: true });
        // Ensure the page-level portalled broker menu is closed before the form hide transition.
        const importBrokerField = runtime.formContainer.querySelector('[data-shared-select-field]');
        if (importBrokerField instanceof HTMLElement) {
            importBrokerField.classList.remove('is-open');
            const dd = document.getElementById('investment_import_broker_dropdown');
            if (dd instanceof HTMLElement) {
                dd.hidden = true;
                dd.style.position = '';
                dd.style.left = '';
                dd.style.top = '';
                dd.style.bottom = '';
                dd.style.right = '';
                dd.style.width = '';
                dd.style.minWidth = '';
                dd.style.maxHeight = '';
                dd.style.maxWidth = '';
                dd.style.zIndex = '';
                dd.style.overflowY = '';
                dd.style.overscrollBehavior = '';
            }
            const tr = importBrokerField.querySelector('[data-shared-select-trigger]');
            if (tr instanceof HTMLElement) tr.setAttribute('aria-expanded', 'false');
        }
        runtime.state.investmentFormHideTimer = window.setTimeout(() => {
            runtime.formContainer.style.display = 'none';
            runtime.formContainer.style.removeProperty('--investment-import-modal-height');
            document.body.style.removeProperty('--investment-import-control-rail-top');
            runtime.syncInvestmentFormLayout();
            setInvestmentImportControlState({ isOpen: false });
            runtime.state.investmentFormHideTimer = null;
        }, 400);
    }

function buildInvestmentRequestOptions(overrides = {}) {
        const csrfToken = String(
            window.WORTHWARD_APP?.security?.investmentCsrfToken || ''
        ).trim();
        const headers = {
            'Cache-Control': 'no-cache',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
            ...(overrides.headers || {}),
        };
        return {
            credentials: 'same-origin',
            cache: 'no-store',
            ...overrides,
            headers,
        };
    }

async function fetchInvestmentData({ expectedStoreVersion = '' } = {}) {
        runtime.reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'starting transactions fetch', {
            pathname: window.location.pathname,
            search: window.location.search,
            visibilityState: document.visibilityState,
        });
        let response;
        try {
            const expectedVersion = String(expectedStoreVersion || '').trim();
            const requestUrl = expectedVersion
                ? `/api/investment/transactions?store_version=${encodeURIComponent(expectedVersion)}`
                : '/api/investment/transactions';
            response = await fetch(requestUrl, buildInvestmentRequestOptions());
        } catch (error) {
            runtime.reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions fetch failed before response', {
                pathname: window.location.pathname,
                search: window.location.search,
                visibilityState: document.visibilityState,
                errorName: error?.name || '',
                errorMessage: error?.message || '',
            });
            throw error;
        }
        runtime.reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions response received', {
            status: response.status,
            ok: response.ok,
            visibilityState: document.visibilityState,
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
            runtime.reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions payload reported failure', {
                status: response.status,
                ok: response.ok,
                success: data.success,
                error: data.error || '',
            });
            throw new Error(data.error || `Failed to load investment data: ${response.status}`);
        }
        if (
            String(expectedStoreVersion || '').trim()
            && String(data.investment_store_version || '').trim() !== String(expectedStoreVersion).trim()
        ) {
            throw new Error('The refreshed investment table did not read the committed store version.');
        }
        const appliedTaxLotCompatibilityFallbacks = (
            runtime.applyInvestmentVerifiedTaxLotCompatibilityFallbacks(data)
        );
        if (appliedTaxLotCompatibilityFallbacks.length) {
            data.investment_client_compatibility = {
                verified_tax_lot_fallbacks: appliedTaxLotCompatibilityFallbacks,
            };
        }
        runtime.reportInvestmentFetchAbortDebug('C', 'investment.js:fetchInvestmentData', 'transactions payload rendered successfully', {
            transactionCount: Array.isArray(data.transactions) ? data.transactions.length : -1,
            success: data.success,
        });
        window.WORTHWARD_INVESTMENT_DATA = data;
        const previousUrlStateApplying = runtime.state.investmentUrlStateApplying;
        runtime.state.investmentUrlStateApplying = true;
        let valuationStatus;
        try {
            valuationStatus = await runtime.renderTransactionTable(data.transactions || []);
        } finally {
            runtime.state.investmentUrlStateApplying = previousUrlStateApplying;
        }
        const processedTransactions = Array.isArray(runtime.state.investmentProcessedTransactionsCache)
            ? [...runtime.state.investmentProcessedTransactionsCache]
            : [];
        runtime.clearStaleTransferReviewFeedback(processedTransactions);
        runtime.applyInvestmentUrlStateFromLocation({render: true});
        runtime.scheduleInvestmentSegmentedPillUpdate();
        return { data, valuationStatus, processedTransactions };
    }

    return {
        setInvestmentHoverContainerPayload,
        getInvestmentHoverContainerPayload,
        clearInvestmentChartLinkedHoverState,
        bindInvestmentHoverContainerPersistence,
        renderInvestmentMetricBreakdownCard,
        renderMetricCards,
        getBrokerRewardRealizedIncome,
        getBrokerRewardLedgerRows,
        renderFundingMetricCards,
        mapInvestmentMetricRowsToGlobalLedgerNos,
        getInvestmentBrokerSummaryTransactions,
        getInvestmentBrokerSummaryTotalEquity,
        resolveInvestmentMetricsCurrentCash,
        renderInvestmentMetricsPanel,
        resetInvestmentDashboard,
        syncImportValidationState,
        syncInvestmentImportContainerHeight,
        setInvestmentImportControlState,
        openInvestmentImportForm,
        closeInvestmentImportForm,
        buildInvestmentRequestOptions,
        fetchInvestmentData,
    };
}

