/**
 * Holdings workspace rendering and navigation.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentHoldingsWorkspaceRuntime(runtime) {
function syncInvestmentFormLayout() {
        if (!runtime.formContainer || !runtime.historyTable || !runtime.parentSection) return;
        runtime.historyTable.style.transform = 'translateY(0)';
        runtime.parentSection.style.removeProperty('padding-bottom');
    }

function setInvestmentSharedChartDateRange(chartPoints = []) {
        const normalizedDates = Array.isArray(chartPoints)
            ? chartPoints
                .map((point) => runtime.normalizeLedgerDate(point?.date))
                .filter(Boolean)
            : [];
        if (runtime.isInvestmentDailyEquityLiveRange()) {
            const liveDateKey = runtime.getInvestmentDailyEquityLiveSessionDateKey();
            if (liveDateKey) {
                normalizedDates.push(liveDateKey);
            }
        }
        runtime.state.investmentSharedChartDateRange = Array.from(new Set(normalizedDates)).sort();
    }

function getInvestmentSharedChartDateRange(fallbackDates = []) {
        if (Array.isArray(runtime.state.investmentSharedChartDateRange) && runtime.state.investmentSharedChartDateRange.length) {
            return [...runtime.state.investmentSharedChartDateRange];
        }
        const normalizedFallbackDates = Array.isArray(fallbackDates)
            ? fallbackDates.map((value) => runtime.normalizeLedgerDate(value)).filter(Boolean)
            : [];
        return Array.from(new Set(normalizedFallbackDates)).sort();
    }

function constrainTickerDatesToSharedRange(tickerDates = []) {
        const normalizedTickerDates = Array.isArray(tickerDates)
            ? tickerDates.map((value) => runtime.normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!normalizedTickerDates.length) return [];
        const sharedDates = getInvestmentSharedChartDateRange(normalizedTickerDates);
        if (!sharedDates.length) return normalizedTickerDates;
        const sharedStart = sharedDates[0];
        const sharedEnd = sharedDates[sharedDates.length - 1];
        const boundedDates = normalizedTickerDates.filter((date) => date >= sharedStart && date <= sharedEnd);
        return boundedDates.length ? boundedDates : normalizedTickerDates;
    }

function renderHoldingsTable(
        summaries,
        tickerProfiles,
        TOTAL_EQUITY,
        AGGREGATE_CASH,
        {
            filteredSummaries = summaries,
            summaryScope = 'all',
            brokerBenefitMetrics = {},
            holdingsSummaryMetrics = null,
        } = {},
    ) {
        if (runtime.state.investmentAggregateSecurityTransferState.blocked) {
            return `
                <div class="investment-holdings-table-shell">
                    <div class="investment-holdings-empty">${runtime.escapeHtml(runtime.getInvestmentAggregateSecurityTransferBlockedMessage())}</div>
                </div>
            `;
        }
        const brokerRewardRealizedIncome = runtime.getBrokerRewardRealizedIncome(brokerBenefitMetrics);
        const hasBrokerRewardRealizedIncome = Math.abs(brokerRewardRealizedIncome) > 1e-9;
        if (!summaries.length && !hasBrokerRewardRealizedIncome) {
            return `
                <div class="investment-holdings-table-shell">
                    <div class="investment-holdings-empty">No holdings or ticker-linked transactions yet.</div>
                </div>
            `;
        }

        const normalizedSummaryScope = window.WORTHWARD_INVESTMENT_FILTERS?.normalizeSummaryScope(summaryScope) || 'all';
        const summarySummaries = normalizedSummaryScope === 'all' ? summaries : filteredSummaries;
        const summaryCountLabel = window.WORTHWARD_INVESTMENT_FILTERS?.buildSummaryCountLabel({
            allCount: summaries.length,
            filteredCount: filteredSummaries.length,
            scope: normalizedSummaryScope,
        }) || `${summaries.length} total`;
        const openSummaries = summarySummaries.filter((summary) => summary.hasOpenPosition);
        const openCount = openSummaries.length;
        const closedCount = summarySummaries.length - openCount;
        const pnlCoverage = normalizedSummaryScope === 'all' && holdingsSummaryMetrics?.pnlCoverage
            ? holdingsSummaryMetrics.pnlCoverage
            : runtime.getInvestmentAggregatePnlCoverage(summarySummaries);
        const pnlCoverageLabel = pnlCoverage.status === 'partial' ? 'Partial · total unavailable' : 'Unavailable';
        const hasPnlUnavailable = (
            (normalizedSummaryScope === 'all' && holdingsSummaryMetrics?.pnlUnavailable === true)
            || runtime.isInvestmentAggregatePnlUnavailable(summarySummaries)
        );
        const holdingsRealizedPnl = summarySummaries.reduce(
            (sum, summary) => sum + (
                Number(runtime.getInvestmentCanonicalSummaryRealizedPnl(summary)) || 0
            ),
            0,
        );
        const fallbackTotalRealizedPnl = holdingsRealizedPnl + brokerRewardRealizedIncome;
        const totalRealizedPnl = normalizedSummaryScope === 'all'
            && Number.isFinite(Number(holdingsSummaryMetrics?.totalRealizedPnl))
            ? Number(holdingsSummaryMetrics.totalRealizedPnl)
            : fallbackTotalRealizedPnl;
        const totalUnrealizedPnl = summarySummaries.reduce((sum, summary) => sum + (Number(summary.unrealizedPnl) || 0), 0);
        const totalDailyPnl = summarySummaries.reduce((totals, summary) => {
            if (summary?.pnlUnavailable === true) return totals;
            const dailyPnl = runtime.resolveInvestmentHoldingDailyPnl(summary);
            totals.realized += Number(dailyPnl.realized) || 0;
            if (dailyPnl.unrealized === null || dailyPnl.unrealized === undefined) {
                totals.unrealized = null;
            } else if (totals.unrealized !== null) {
                totals.unrealized += Number(dailyPnl.unrealized) || 0;
            }
            return totals;
        }, { realized: 0, unrealized: 0 });
        const cumulativePnl = totalRealizedPnl + totalUnrealizedPnl;
        const totalNetMarketValue = openSummaries.reduce((sum, summary) => sum + (Number.isFinite(summary.marketValue) ? summary.marketValue : NaN), 0);
        const totalWeight = Number.isFinite(TOTAL_EQUITY) && Math.abs(TOTAL_EQUITY) > 1e-9
            ? (totalNetMarketValue / TOTAL_EQUITY) * 100
            : 0;
        const totalRealizedClass = hasPnlUnavailable
            ? ''
            : runtime.getInvestmentHoldingsRealizedToneClass(totalRealizedPnl);
        const totalUnrealizedClass = hasPnlUnavailable
            ? ''
            : (totalUnrealizedPnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative');
        const cumulativePnlClass = hasPnlUnavailable
            ? ''
            : (cumulativePnl >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative');

        const rowsHtml = summaries.map((summary, index) => {
            const profile = runtime.resolveInvestmentTickerProfile(tickerProfiles, summary.ticker);
            const tickerLabel = runtime.formatInvestmentTickerForDisplay(summary.ticker);
            const companyName = runtime.resolveInvestmentTickerCompanyName(tickerProfiles, summary.ticker);
            const logoUrls = runtime.resolveInvestmentLogoUrls(profile, summary.ticker);
            const moneyMarketFundTokenLogoClass = runtime.getMoneyMarketFundTokenLogoClass(summary.ticker);
            const logoHtml = moneyMarketFundTokenLogoClass
                ? `<span class="ticker-identity-logo ${moneyMarketFundTokenLogoClass}" aria-hidden="true"></span>`
                : `
                                    <img class="ticker-identity-logo"
                                         alt=""
                                         hidden
                                         loading="eager"
                                         decoding="async"
                                         data-investment-logo-image
                                         data-logo-url="${runtime.escapeHtml(JSON.stringify(logoUrls))}"
                                         data-ticker="${runtime.escapeHtml(summary.ticker)}">
                                    <span class="ticker-identity-logo ticker-identity-logo-placeholder" aria-hidden="true"></span>
                `;
            const averagePriceDisplay = summary.averagePrice === null ? '-' : runtime.formatHoldingsMoney(summary.averagePrice);
            const positionDisplay = runtime.formatHoldingsPosition(summary.shares);
            const pnlUnavailable = summary?.pnlUnavailable === true;
            const realizedPnl = runtime.getInvestmentCanonicalSummaryRealizedPnl(summary);
            const realizedPnlLocal = runtime.getInvestmentCanonicalSummaryRealizedPnlLocal(summary);
            const realizedClass = pnlUnavailable
                ? ''
                : runtime.getInvestmentHoldingsRealizedToneClass(realizedPnl);
            const unrealizedClass = pnlUnavailable || summary.unrealizedPnl === null
                ? ''
                : (summary.unrealizedPnl >= 0
                    ? ' investment-holdings-value-positive'
                    : ' investment-holdings-value-negative');
            const lastClass = runtime.resolveInvestmentLastPriceToneClass(summary.lastPrice, summary.ticker);
            const dailyPnl = runtime.resolveInvestmentHoldingDailyPnl(summary);
            const dailyLastPriceChange = runtime.resolveInvestmentHoldingDailyPriceChange(summary);
            const liveBadgeEligible = runtime.shouldShowInvestmentHoldingLiveBadge(summary.ticker);

            return `
                <tr data-investment-holdings-ticker="${runtime.escapeHtml(summary.ticker)}">
                    <td class="investment-holdings-cell investment-holdings-cell-center">${index + 1}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-ticker">
                        <a class="investment-holdings-ticker-anchor" href="${runtime.escapeHtml(runtime.buildInvestmentStockDetailsHref(summary.ticker))}" data-investment-stock-link data-investment-stock-ticker="${runtime.escapeHtml(summary.ticker)}">
                            <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link" data-ticker="${runtime.escapeHtml(summary.ticker)}">
                                <div class="ticker-identity-row">
                                    ${logoHtml}
                                    <span class="ticker-identity-copy">
                                        <span class="suggestion-symbol ticker-identity-symbol">${runtime.escapeHtml(tickerLabel)}</span>
                                        ${runtime.renderInvestmentTickerIdentityNameHtml(companyName)}
                                    </span>
                                </div>
                            </div>
                        </a>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">
                        <span class="investment-holdings-cost-basis-stack">
                            <span class="trade-metric-value investment-stock-details-metric-value">${runtime.renderWorkspaceMetricValueContent(averagePriceDisplay)}</span>
                        </span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${lastClass}">
                        <span class="investment-holdings-pnl-stack">
                            ${runtime.renderInvestmentLiveValue('last', summary.lastPrice, {
                                ticker: summary.ticker,
                                className: `trade-metric-value investment-stock-details-metric-value${lastClass}`,
                                formatter: (nextValue) => runtime.formatHoldingsLocalMoney(nextValue, summary.quoteCurrency),
                                useSplitValue: true,
                            })}
                            ${summary.hasOpenPosition
                                ? runtime.renderInvestmentHoldingsDailyPnlBadge(
                                    'daily_last_price',
                                    summary.ticker,
                                    dailyLastPriceChange,
                                    {
                                        formatter: (nextValue) => runtime.formatSignedHoldingsLocalMoney(
                                            nextValue,
                                            summary.quoteCurrency,
                                        ),
                                        liveEligible: liveBadgeEligible,
                                    },
                                )
                                : ''}
                        </span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">
                        <span class="trade-metric-value investment-stock-details-metric-value">${runtime.renderWorkspaceMetricValueContent(positionDisplay)}</span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">
                        ${runtime.renderInvestmentLiveValue('market_value', summary.hasOpenPosition ? summary.marketValue : null, {
                            ticker: summary.ticker,
                            className: 'trade-metric-value investment-stock-details-metric-value',
                            formatter: (nextValue) => nextValue === null ? '-' : runtime.formatHoldingsMoney(nextValue),
                            useSplitValue: true,
                        })}
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${realizedClass}">
                        <span class="investment-holdings-pnl-stack">
                            ${pnlUnavailable ? runtime.renderWorkspaceMetricValueContent('Unavailable') : runtime.renderHoldingsDualCurrencyValue(
                                realizedPnl,
                                realizedPnlLocal,
                                summary.quoteCurrency,
                                { valueClass: realizedClass },
                            )}
                            ${!pnlUnavailable && summary.hasOpenPosition
                                ? runtime.renderInvestmentHoldingsDailyPnlBadge(
                                    'daily_realized_pnl',
                                    summary.ticker,
                                    dailyPnl.realized,
                                    { hideZeroValue: true },
                                )
                                : ''}
                        </span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money${unrealizedClass}">
                        <span class="investment-holdings-pnl-stack">
                            ${pnlUnavailable ? runtime.renderWorkspaceMetricValueContent('Unavailable') : runtime.renderInvestmentLiveValue('unrealized_pnl', summary.unrealizedPnl, {
                                ticker: summary.ticker,
                                className: `trade-metric-value investment-stock-details-metric-value ${unrealizedClass.trim()}`,
                                formatter: (nextValue) => nextValue === null ? '-' : runtime.formatHoldingsMoney(nextValue),
                                useSplitValue: true,
                            })}
                            ${!pnlUnavailable && summary.hasOpenPosition
                                ? runtime.renderInvestmentHoldingsDailyPnlBadge(
                                    'daily_unrealized_pnl',
                                    summary.ticker,
                                    dailyPnl.unrealized,
                                    { liveEligible: liveBadgeEligible },
                                )
                                : ''}
                        </span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">
                        ${runtime.renderInvestmentLiveValue('position_weight', summary.hasOpenPosition ? summary.positionWeight : null, {
                            ticker: summary.ticker,
                            className: 'trade-metric-value investment-stock-details-metric-value',
                            formatter: (nextValue) => nextValue === null ? '-' : runtime.formatHoldingsPercent(nextValue),
                            useSplitValue: true,
                        })}
                    </td>
                </tr>
            `;
        }).join('');
        const brokerRewardRowHtml = hasBrokerRewardRealizedIncome
            ? `
                <tr class="investment-holdings-broker-rewards-row" data-investment-broker-rewards-row>
                    <td class="investment-holdings-cell investment-holdings-cell-center">${summaries.length + 1}</td>
                    <td class="investment-holdings-cell investment-holdings-cell-ticker">
                        <div class="suggestion-item timing-suggestion-item ticker-identity-item investment-holdings-ticker-link investment-holdings-broker-rewards-identity">
                            <div class="ticker-identity-row">
                                <span class="ticker-identity-logo investment-broker-reward-token-logo" aria-hidden="true"></span>
                                <span class="ticker-identity-copy">
                                    <span class="suggestion-symbol ticker-identity-symbol">Broker rewards</span>
                                    <span class="suggestion-name ticker-identity-name" title="Coupons, cash rewards &amp; KOL rewards">Coupons, cash rewards &amp; KOL rewards</span>
                                </span>
                            </div>
                        </div>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">-</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">-</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">-</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">-</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money investment-holdings-value-positive">
                        <span class="trade-metric-value investment-stock-details-metric-value investment-holdings-value-positive">${runtime.renderWorkspaceMetricValueContent(runtime.formatHoldingsMoney(brokerRewardRealizedIncome))}</span>
                    </td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">-</td>
                    <td class="investment-holdings-cell investment-holdings-cell-money">-</td>
                </tr>
            `
            : '';

        const cashEquivalents = runtime.computeHoldingsCashEquivalents(summaries, AGGREGATE_CASH);
        const cashAllocation = runtime.calculateHoldingsSummaryAllocation(AGGREGATE_CASH, TOTAL_EQUITY);
        const cashEquivalentsAllocation = runtime.calculateHoldingsSummaryAllocation(cashEquivalents, TOTAL_EQUITY);
        const cashClass = Number.isFinite(AGGREGATE_CASH) && AGGREGATE_CASH >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const cashEquivalentsClass = Number.isFinite(cashEquivalents) && cashEquivalents >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const totalEquityClass = Number.isFinite(TOTAL_EQUITY) && TOTAL_EQUITY >= 0
            ? ' investment-holdings-value-positive'
            : ' investment-holdings-value-negative';
        const hasLiveBadgeSession = runtime.hasInvestmentHoldingLiveBadgeSession(summarySummaries);

        const summaryRowHtml = `
            <tr class="investment-holdings-summary-row" data-table-summary-row data-pnl-coverage="${pnlCoverage.status}" title="${runtime.escapeHtml(pnlCoverage.missingTickers.length ? `P&L unavailable for: ${pnlCoverage.missingTickers.join(', ')}` : (pnlCoverage.cashFlowFxUnavailable ? 'Cash-flow FX unavailable' : ''))}" data-summary-scope="${normalizedSummaryScope}" data-summary-all-count="${summaries.length}" data-summary-filtered-count="${filteredSummaries.length}">
                <td class="investment-holdings-cell investment-holdings-cell-center"></td>
                <td class="investment-holdings-cell investment-holdings-cell-ticker">
                    <span class="investment-holdings-summary-ticker-body">
                        <span class="investment-holdings-summary-instruments">${summaryCountLabel}; ${openCount} open, ${closedCount} closed</span>
                        <span class="investment-holdings-summary-metrics">
                            <span class="investment-holdings-summary-metric-row">
                                <span class="investment-holdings-summary-metric-label">Cash</span>
                                ${runtime.renderInvestmentLiveValue('summary_cash_balance', Number.isFinite(AGGREGATE_CASH) ? AGGREGATE_CASH : null, {
                                    className: `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${cashClass}`,
                                    formatter: (nextValue) => runtime.formatInvestmentCurrentCash(
                                        nextValue,
                                        holdingsSummaryMetrics?.cashIsApproximate === true,
                                    ),
                                    useSplitValue: true,
                                })}
                                ${runtime.renderInvestmentHoldingsAllocationBadge('summary_cash_allocation', cashAllocation, AGGREGATE_CASH)}
                            </span>
                            <span class="investment-holdings-summary-metric-row">
                                <span class="investment-holdings-summary-metric-label">Cash equivalents</span>
                                ${runtime.renderInvestmentLiveValue('summary_cash_equivalents', cashEquivalents, {
                                    className: `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${cashEquivalentsClass}`,
                                    formatter: (nextValue) => nextValue === null ? '-' : runtime.formatHoldingsMoney(nextValue),
                                    useSplitValue: true,
                                })}
                                ${runtime.renderInvestmentHoldingsAllocationBadge('summary_cash_equivalents_allocation', cashEquivalentsAllocation, cashEquivalents)}
                            </span>
                            <span class="investment-holdings-summary-metric-row">
                                <span class="investment-holdings-summary-metric-label">Total equity</span>
                                ${runtime.renderInvestmentLiveValue('summary_total_equity', Number.isFinite(TOTAL_EQUITY) ? TOTAL_EQUITY : null, {
                                    className: `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${totalEquityClass}`,
                                    formatter: (nextValue) => nextValue === null ? '-' : runtime.formatHoldingsMoney(nextValue),
                                    useSplitValue: true,
                                })}
                                <span class="investment-holdings-allocation-track" aria-hidden="true"></span>
                            </span>
                            <span class="investment-holdings-summary-metric-row">
                                <span class="investment-holdings-summary-metric-label">Cumulative P&amp;L</span>
                                ${hasPnlUnavailable ? runtime.renderWorkspaceMetricValueContent(pnlCoverageLabel) : runtime.renderInvestmentLiveValue('summary_cumulative_pnl', cumulativePnl, {
                                    className: `trade-metric-value investment-stock-details-metric-value investment-holdings-live-value${cumulativePnlClass}`,
                                    formatter: (nextValue) => runtime.formatSignedHoldingsMoney(nextValue),
                                    useSplitValue: true,
                                })}
                            </span>
                        </span>
                    </span>
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money"></td>
                <td class="investment-holdings-cell investment-holdings-cell-money">
                    ${runtime.renderInvestmentLiveValue('summary_market_value', totalNetMarketValue, {
                        className: 'trade-metric-value investment-stock-details-metric-value',
                        formatter: (nextValue) => runtime.formatHoldingsMoney(nextValue),
                        useSplitValue: true,
                    })}
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalRealizedClass}">
                    <span class="investment-holdings-pnl-stack">
                        <span class="trade-metric-value investment-stock-details-metric-value${totalRealizedClass}">${runtime.renderWorkspaceMetricValueContent(hasPnlUnavailable ? pnlCoverageLabel : runtime.formatHoldingsMoney(totalRealizedPnl))}</span>
                        ${!hasPnlUnavailable ? runtime.renderInvestmentHoldingsDailyPnlBadge(
                            'summary_daily_realized_pnl',
                            '',
                            totalDailyPnl.realized,
                            { hideZeroValue: true },
                        ) : ''}
                    </span>
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money${totalUnrealizedClass}">
                    <span class="investment-holdings-pnl-stack">
                        ${hasPnlUnavailable ? runtime.renderWorkspaceMetricValueContent(pnlCoverageLabel) : runtime.renderInvestmentLiveValue('summary_unrealized_pnl', totalUnrealizedPnl, {
                            className: `trade-metric-value investment-stock-details-metric-value ${totalUnrealizedClass.trim()}`,
                            formatter: (nextValue) => runtime.formatHoldingsMoney(nextValue),
                            useSplitValue: true,
                        })}
                        ${!hasPnlUnavailable ? runtime.renderInvestmentHoldingsDailyPnlBadge(
                            'summary_daily_unrealized_pnl',
                            '',
                            totalDailyPnl.unrealized,
                            { liveEligible: hasLiveBadgeSession },
                        ) : ''}
                    </span>
                </td>
                <td class="investment-holdings-cell investment-holdings-cell-money">
                    ${runtime.renderInvestmentLiveValue('summary_position_weight', totalWeight, {
                        formatter: (nextValue) => runtime.formatHoldingsPercent(nextValue),
                        useSplitValue: true,
                    })}
                </td>
            </tr>
        `;
        const holdingsColumnGroupHtml = `
            <colgroup>
                <col style="width: 8%;">
                <col style="width: 32%;">
                <col style="width: 10%;">
                <col style="width: 10%;">
                <col style="width: 10%;">
                <col style="width: 10%;">
                <col style="width: 7%;">
                <col style="width: 7%;">
                <col style="width: 6%;">
            </colgroup>
        `;

        return `
            <div class="scrollable-data-table-shell investment-holdings-table-shell">
                <table class="settings-table trade-transactions-table scrollable-data-table investment-holdings-table" data-table-header data-table-summary-scope="${normalizedSummaryScope}" aria-label="Holdings columns and portfolio summary">
                    ${holdingsColumnGroupHtml}
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Ticker</th>
                            <th>Average price</th>
                            <th>Last price</th>
                            <th>Position</th>
                            <th>Market value</th>
                            <th>Realized P&amp;L</th>
                            <th>Unrealized P&amp;L</th>
                            <th>%</th>
                        </tr>
                        ${summaryRowHtml}
                    </thead>
                </table>
                <div class="trade-transactions-wrap scrollable-data-table-scroll investment-holdings-table-scroll" data-table-scroll>
                    <table class="settings-table trade-transactions-table scrollable-data-table investment-holdings-table" data-table-body>
                        ${holdingsColumnGroupHtml}
                        <tbody>${rowsHtml}${brokerRewardRowHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

function bindHoldingsHistoryInteractions(holdingsPanel) {
        if (!holdingsPanel) return;
        holdingsPanel.querySelectorAll('tr[data-investment-holdings-ticker]').forEach((row) => {
            if (row.dataset.historyHoverBound === '1') return;
            row.dataset.historyHoverBound = '1';
            const activateRelatedHistoryRow = () => {
                const ticker = row.dataset.investmentHoldingsTicker || '';
                const historyRow = runtime.getLatestHistoryRowForTicker(ticker);
                const ledgerNo = Number(historyRow?.dataset.investmentHistoryRow || 0);
                runtime.syncHoldingsChartHoverState(ticker, ledgerNo);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) return;
                runtime.activateInvestmentHistoryRows([ledgerNo], { behavior: 'auto', scroll: false });
            };
            const clearRelatedHistoryRow = () => {
                runtime.syncHoldingsChartHoverState('', 0);
                runtime.clearInvestmentHistoryHighlights();
            };
            row.addEventListener('mouseenter', activateRelatedHistoryRow);
            row.addEventListener('mouseleave', clearRelatedHistoryRow);
            row.addEventListener('focusin', activateRelatedHistoryRow);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearRelatedHistoryRow();
            });
        });
    }

function syncSelectedStockLinkState() {
        document.querySelectorAll('[data-investment-stock-link]').forEach((link) => {
            const ticker = runtime.normalizeInvestmentTicker(link.dataset.investmentStockTicker || '');
            link.setAttribute('href', runtime.buildInvestmentStockDetailsHref(ticker));
            link.classList.toggle('is-active', Boolean(runtime.state.selectedInvestmentStockTicker) && ticker === runtime.state.selectedInvestmentStockTicker);
        });
    }

function bindHoldingsStockDetailsLinks(holdingsPanel) {
        if (!holdingsPanel) return;
        holdingsPanel.querySelectorAll('[data-investment-stock-link]').forEach((link) => {
            if (link.dataset.stockDetailsBound === '1') return;
            link.dataset.stockDetailsBound = '1';
            link.addEventListener('click', (event) => {
                event.preventDefault();
                runtime.selectInvestmentStockTicker(link.dataset.investmentStockTicker || '', { focusView: true });
            });
        });
        syncSelectedStockLinkState();
    }

function bindStockDetailsHistoryInteractions(stockDetailsPanel) {
        if (!stockDetailsPanel) return;
        const hoverContainer = stockDetailsPanel.querySelector('.investment-stock-details-table-shell')
            || stockDetailsPanel.querySelector('.investment-stock-details-table-host')
            || stockDetailsPanel;
        runtime.setInvestmentHoverContainerPayload(hoverContainer, null);
        runtime.bindInvestmentHoverContainerPersistence(hoverContainer);
        stockDetailsPanel.querySelectorAll('tr[data-investment-stock-detail-ledger]').forEach((row) => {
            if (row.dataset.stockHistoryBound === '1') return;
            row.dataset.stockHistoryBound = '1';
            const activateRelatedHistoryRow = () => {
                const ledgerNo = Number(row.dataset.investmentStockDetailLedger || 0);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) return;
                const hoverPayload = {
                    hoverTicker: ensureSelectedInvestmentStockTicker(),
                    hoverLedgerNo: ledgerNo,
                    historyLedgerNos: [ledgerNo],
                    stockDetailLedgerNos: [ledgerNo],
                    interactionLedgerNo: ledgerNo,
                    historyBehavior: 'auto',
                    historyScroll: true,
                    stockDetailBehavior: 'auto',
                    stockDetailScroll: false,
                };
                runtime.setInvestmentHoverContainerPayload(hoverContainer, hoverPayload);
                runtime.syncInvestmentHoverLinkedViews(hoverPayload);
            };
            const clearRelatedHistoryRow = () => {
                if (hoverContainer instanceof HTMLElement && hoverContainer.matches(':hover')) return;
                runtime.clearInvestmentChartLinkedHoverState();
            };
            row.addEventListener('mouseenter', activateRelatedHistoryRow);
            row.addEventListener('mouseleave', clearRelatedHistoryRow);
            row.addEventListener('focusin', activateRelatedHistoryRow);
            row.addEventListener('focusout', (event) => {
                if (row.contains(event.relatedTarget)) return;
                clearRelatedHistoryRow();
            });
        });
    }

function getAvailableInvestmentStockTickers() {
        if (Array.isArray(runtime.state.investmentTickerSummariesCache) && runtime.state.investmentTickerSummariesCache.length) {
            return runtime.state.investmentTickerSummariesCache
                .map((summary) => runtime.normalizeInvestmentTicker(summary?.ticker))
                .filter(Boolean);
        }
        return Array.from(new Set((Array.isArray(runtime.state.investmentProcessedTransactionsCache) ? runtime.state.investmentProcessedTransactionsCache : [])
            .filter((txn) => runtime.shouldTrackHoldingTicker(txn))
            .map((txn) => runtime.getInvestmentCanonicalTicker(txn?.ticker))
            .filter(Boolean)));
    }

function ensureSelectedInvestmentStockTicker() {
        const availableTickers = getAvailableInvestmentStockTickers();
        if (!availableTickers.length) {
            const locationTicker = runtime.getInvestmentLocationTicker();
            if (locationTicker) {
                runtime.state.selectedInvestmentStockTicker = locationTicker;
            }
            runtime.rememberInvestmentPageState({ ticker: runtime.state.selectedInvestmentStockTicker || '' });
            return runtime.normalizeInvestmentTicker(runtime.state.selectedInvestmentStockTicker || '');
        }
        if (!availableTickers.includes(runtime.state.selectedInvestmentStockTicker)) {
            runtime.state.selectedInvestmentStockTicker = availableTickers[0];
        }
        runtime.rememberInvestmentPageState({ ticker: runtime.state.selectedInvestmentStockTicker });
        return runtime.state.selectedInvestmentStockTicker;
    }

function buildInvestmentStockDonutMarkup(summary, profile) {
        const logoUrl = runtime.resolveInvestmentLogoUrl(profile, summary?.ticker || 'stock');
        const ticker = runtime.escapeHtml(summary?.ticker || 'Ticker');
        const logoMarkup = logoUrl
            ? `<img class="portfolio-donut-logo investment-stock-details-donut-logo" src="${runtime.escapeHtml(logoUrl)}" alt="${ticker} logo" loading="eager" decoding="async" data-ticker="${ticker}" data-style-token-donut-angle="44.4">`
            : '';
        return `
            <div class="style-token-portfolio-donut-shell investment-stock-details-donut-shell">
                <div class="portfolio-donut-orbit style-token-portfolio-donut-orbit investment-stock-details-donut-orbit" aria-hidden="true">
                    <div class="portfolio-donut-logo-layer investment-stock-details-donut-logo-layer">
                        ${logoMarkup}
                    </div>
                    <div class="portfolio-donut investment-stock-details-donut" style="--portfolio-donut-fill: ${runtime.STOCK_DETAILS_DONUT_GRAY_FILL};"></div>
                </div>
            </div>
        `;
    }

    return {
        syncInvestmentFormLayout,
        setInvestmentSharedChartDateRange,
        getInvestmentSharedChartDateRange,
        constrainTickerDatesToSharedRange,
        renderHoldingsTable,
        bindHoldingsHistoryInteractions,
        syncSelectedStockLinkState,
        bindHoldingsStockDetailsLinks,
        bindStockDetailsHistoryInteractions,
        getAvailableInvestmentStockTickers,
        ensureSelectedInvestmentStockTicker,
        buildInvestmentStockDonutMarkup,
    };
}

