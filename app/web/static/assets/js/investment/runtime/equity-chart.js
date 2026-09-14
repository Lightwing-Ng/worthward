/**
 * Equity chart rendering and historical P&L state.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentEquityChartRuntime(runtime) {
function updateDashboardWithEquity(
        processed,
        latestSnapshot,
        latestPrices,
        rawTransactions,
        chartPoints = [],
        tickerClosePrices = {},
        { refreshStockDetailsPanel = true } = {},
    ) {
        const last = latestSnapshot || processed[processed.length - 1];
        if (!last) return chartPoints;

        const holdingsPanel = document.getElementById('investment_holdings_panel');
        const metricsPanel = document.getElementById('investment_metrics_panel');
        if (!holdingsPanel || !metricsPanel || !(runtime.investmentStockDetailsPanel instanceof HTMLElement)) {
            return chartPoints;
        }
        const shouldAnimateVisibleMetricsPanel = (
            runtime.state.activeInvestmentView === 'holdings'
            || runtime.state.activeInvestmentView === 'metrics'
            || (runtime.state.activeInvestmentView === 'stock_details' && refreshStockDetailsPanel)
        );
        if (shouldAnimateVisibleMetricsPanel) {
            runtime.lockInvestmentSurfaceHeight();
        }

        const tickerProfiles = window.WORTHWARD_INVESTMENT_DATA?.ticker_profiles || {};
        runtime.state.investmentDummyTickerProfiles = tickerProfiles;
        runtime.state.investmentTickerClosePricesCache = tickerClosePrices && typeof tickerClosePrices === 'object'
            ? { ...tickerClosePrices }
            : {};
        const mergedLatestPrices = {
            ...(latestPrices && typeof latestPrices === 'object' ? latestPrices : {}),
            ...(runtime.state.investmentLatestPricesCache && typeof runtime.state.investmentLatestPricesCache === 'object' ? runtime.state.investmentLatestPricesCache : {}),
        };
        const aggregateTransactions = runtime.getInvestmentAggregateOnlyTransactions(rawTransactions);
        const rawAggregateDisplayCash = Number(last?.aggregate_display_cash);
        const AGGREGATE_CASH = Number.isFinite(rawAggregateDisplayCash)
            ? rawAggregateDisplayCash
            : Number(last?.aggregate_running_cash ?? last?.running_cash);
        const chartTotalEquity = runtime.getLatestDashboardEquity(processed, chartPoints);
        const initialTickerSummaries = runtime.applyInvestmentAggregatePnlAvailability(
            runtime.buildTickerSummaries(
                aggregateTransactions,
                mergedLatestPrices,
                chartTotalEquity,
                tickerClosePrices,
            ),
        );
        const liveAggregateTotalEquity = runtime.computeInvestmentLiveHoldingsTotalEquity(
            initialTickerSummaries,
            AGGREGATE_CASH,
        );
        const AGGREGATE_TOTAL_EQUITY = liveAggregateTotalEquity;
        const tickerSummaries = runtime.applyInvestmentCurrentTotalEquityToSummaryWeights(
            initialTickerSummaries,
            AGGREGATE_TOTAL_EQUITY,
        );
        const dashboardChartPoints = runtime.isInvestmentCurrentSnapshotDate(last?.date)
            ? runtime.buildInvestmentCurrentEquityChartPoints(
                chartPoints,
                tickerSummaries,
                AGGREGATE_CASH,
                AGGREGATE_TOTAL_EQUITY,
            )
            : chartPoints;
        if (dashboardChartPoints !== chartPoints) {
            runtime.state.investmentBaseChartPointsCache = [...dashboardChartPoints];
            runtime.state.investmentChartPointsCache = [...dashboardChartPoints];
        }
        runtime.setInvestmentSharedChartDateRange(dashboardChartPoints);
        const fundingMetrics = runtime.getUsdFundingMetrics(processed);
        const brokerBenefitMetrics = runtime.getBrokerBenefitMetrics(
            aggregateTransactions,
            mergedLatestPrices,
            AGGREGATE_TOTAL_EQUITY,
        );
        const holdingsSummaryMetrics = runtime.getHoldingsSummaryMetrics(
            aggregateTransactions,
            mergedLatestPrices,
            AGGREGATE_TOTAL_EQUITY,
            brokerBenefitMetrics,
            { brokerCode: 'all', currentCash: AGGREGATE_CASH },
        );
        refreshInvestmentChartPnlState(holdingsSummaryMetrics);
        if (runtime.state.investmentProcessedTransactionsCache !== processed) {
            runtime.state.investmentProcessedTransactionsCache = Array.isArray(processed) ? processed : [];
            runtime.refreshInvestmentAvailableBrokerCodes();
        }
        if (runtime.state.activeInvestmentView === 'metrics') {
            runtime.ensureInvestmentMetricsBrokerScope();
        }
        runtime.state.investmentTickerSummariesCache = Array.isArray(tickerSummaries) ? [...tickerSummaries] : [];
        runtime.syncHoldingsChartHoverState('', 0);
        holdingsPanel.innerHTML = runtime.renderHoldingsTable(
            tickerSummaries,
            tickerProfiles,
            AGGREGATE_TOTAL_EQUITY,
            AGGREGATE_CASH,
            { brokerBenefitMetrics, holdingsSummaryMetrics },
        );
        runtime.attachHoldingsTableAlignmentSync(holdingsPanel);
        runtime.bindHoldingsLogoFallbacks(holdingsPanel);
        runtime.bindHoldingsHistoryInteractions(holdingsPanel);
        runtime.bindHoldingsStockDetailsLinks(holdingsPanel);
        if (refreshStockDetailsPanel) {
            runtime.renderInvestmentStockDetailsPanel(tickerProfiles);
        } else if (runtime.state.activeInvestmentView === 'stock_details') {
            runtime.syncInvestmentStockDetailsRealtimeMetrics();
        }
        const latestChartPoint = Array.isArray(dashboardChartPoints) && dashboardChartPoints.length
            ? dashboardChartPoints[dashboardChartPoints.length - 1]
            : null;
        runtime.renderInvestmentDummyPortfolioDonut(latestChartPoint || {
            aggregate_running_cash: Number(last?.aggregate_display_cash ?? last?.aggregate_running_cash ?? last?.running_cash) || 0,
            aggregate_display_cash: Number(last?.aggregate_display_cash ?? last?.aggregate_running_cash ?? last?.running_cash) || 0,
            aggregate_total_equity: Number(last?.aggregate_total_equity ?? last?.total_equity) || Number(last?.aggregate_running_cash ?? last?.running_cash) || 0,
            aggregate_holdings_market_values: {},
            running_cash: Number(last?.aggregate_display_cash ?? last?.aggregate_running_cash ?? last?.running_cash) || 0,
            total_equity: Number(last?.aggregate_total_equity ?? last?.total_equity) || Number(last?.aggregate_running_cash ?? last?.running_cash) || 0,
            holdings_market_values: {},
        }, tickerProfiles);

        runtime.renderInvestmentMetricsPanel({
            fundingMetrics,
            holdingsSummaryMetrics,
            brokerBenefitMetrics,
            totalEquity: AGGREGATE_TOTAL_EQUITY,
            latestPrices: mergedLatestPrices,
        });
        if (shouldAnimateVisibleMetricsPanel) {
            runtime.animateInvestmentSurfaceHeight();
        }
        updateInvestmentEquityChartDisplay(runtime.getInvestmentEquityChartInputPoints(dashboardChartPoints));
        runtime.syncInvestmentDummyDonutFromInteraction();
        runtime.syncInvestmentStockDetailsDonutFromInteraction();
        return dashboardChartPoints;
    }

function roundInvestmentChartCurrencyValue(value) {
        const normalizedValue = runtime.getOptionalInvestmentNumber(value);
        if (normalizedValue === null) return null;
        return Math.round(normalizedValue * 100) / 100;
    }

function buildInvestmentChartPnlMetrics(realizedValue, unrealizedValue) {
        const realizedPnl = roundInvestmentChartCurrencyValue(realizedValue);
        const unrealizedPnl = roundInvestmentChartCurrencyValue(unrealizedValue);
        if (realizedPnl === null || unrealizedPnl === null) {
            return { realizedPnl, unrealizedPnl, cumulativePnl: null };
        }
        return {
            realizedPnl,
            unrealizedPnl,
            cumulativePnl: roundInvestmentChartCurrencyValue(realizedPnl + unrealizedPnl),
        };
    }

function setInvestmentCurrentChartPnlMetrics(realizedValue, unrealizedValue) {
        const nextMetrics = buildInvestmentChartPnlMetrics(realizedValue, unrealizedValue);
        const previousMetrics = runtime.state.investmentCurrentChartPnlMetrics;
        const hasChanged = (
            previousMetrics?.realizedPnl !== nextMetrics.realizedPnl
            || previousMetrics?.unrealizedPnl !== nextMetrics.unrealizedPnl
            || previousMetrics?.cumulativePnl !== nextMetrics.cumulativePnl
        );
        runtime.state.investmentCurrentChartPnlMetrics = nextMetrics;
        if (hasChanged) runtime.state.investmentCurrentChartPnlMetricsRevision += 1;
    }

function refreshInvestmentChartPnlState(holdingsSummaryMetrics = null) {
        const pnlUnavailable = holdingsSummaryMetrics?.pnlUnavailable === true;
        const realizedPnl = runtime.getOptionalInvestmentNumber(holdingsSummaryMetrics?.totalRealizedPnl);
        const unrealizedPnl = runtime.getOptionalInvestmentNumber(holdingsSummaryMetrics?.totalUnrealizedPnl);
        setInvestmentCurrentChartPnlMetrics(
            pnlUnavailable ? null : realizedPnl,
            pnlUnavailable ? null : unrealizedPnl,
        );
    }

function getInvestmentChartPnlPointTransactions(pointRecord) {
        const pointDate = runtime.normalizeLedgerDate(pointRecord?.date);
        if (!pointDate) return [];
        const pointMinuteKey = String(pointRecord?.date || '').trim();
        const isIntradayPoint = (
            pointRecord?.is_intraday_equity === true
            && pointMinuteKey.startsWith(`${pointDate} `)
        );
        return runtime.getInvestmentAggregateOnlyTransactions(runtime.state.investmentRawTransactionsCache)
            .filter((txn) => {
                const transactionDate = runtime.normalizeLedgerDate(txn?.date);
                if (!transactionDate) return false;
                if (transactionDate < pointDate) return true;
                if (transactionDate > pointDate) return false;
                if (!isIntradayPoint) return true;
                const effectiveMinuteKey = runtime.getInvestmentOverviewSnapshotEffectiveMinuteKey(
                    txn,
                    pointDate,
                );
                return Boolean(effectiveMinuteKey && effectiveMinuteKey <= pointMinuteKey);
            });
    }

function getInvestmentChartPnlPointPrices(pointRecord) {
        const pointDate = runtime.normalizeLedgerDate(pointRecord?.date);
        if (!pointDate) return {};
        const observedPointPrices = (
            pointRecord?.aggregate_holdings_quote_prices
            || pointRecord?.holdings_quote_prices
            || {}
        );
        const pointPrices = {};
        Object.entries(observedPointPrices).forEach(([ticker, value]) => {
            const normalizedTicker = runtime.getInvestmentCanonicalTicker(ticker);
            const price = Number(value);
            if (!normalizedTicker || !Number.isFinite(price) || price <= 0) return;
            pointPrices[normalizedTicker] = price;
        });
        if (!runtime.state.investmentChartPnlTickerPriceIndex) {
            runtime.state.investmentChartPnlTickerPriceIndex = runtime.buildTickerPriceIndex(
                runtime.state.investmentTickerClosePricesCache,
            );
        }
        const tickerPriceIndex = runtime.state.investmentChartPnlTickerPriceIndex;
        Object.entries(tickerPriceIndex).forEach(([ticker, priceIndex]) => {
            const normalizedTicker = runtime.getInvestmentCanonicalTicker(ticker);
            if (!normalizedTicker || Number.isFinite(pointPrices[normalizedTicker])) return;
            const close = runtime.getIndexedClosePriceOnOrBefore(priceIndex, pointDate);
            if (Number.isFinite(close) && close > 0) {
                pointPrices[normalizedTicker] = close;
            }
        });
        return pointPrices;
    }

function buildInvestmentHistoricalChartPnlMetrics(pointRecord) {
        const unavailableMetrics = {
            realizedPnl: null,
            unrealizedPnl: null,
            cumulativePnl: null,
        };
        if (!pointRecord || typeof pointRecord !== 'object') return unavailableMetrics;
        const cachedMetrics = runtime.state.investmentChartPnlMetricsByPoint.get(pointRecord);
        if (cachedMetrics) return cachedMetrics;

        const pointEquity = runtime.getOptionalInvestmentNumber(
            pointRecord?.aggregate_total_equity ?? pointRecord?.total_equity,
        );
        if (pointRecord?.valuation_complete === false || pointEquity === null) {
            runtime.state.investmentChartPnlMetricsByPoint.set(pointRecord, unavailableMetrics);
            return unavailableMetrics;
        }

        const pointTransactions = getInvestmentChartPnlPointTransactions(pointRecord);
        const pointPrices = getInvestmentChartPnlPointPrices(pointRecord);
        const pointDate = runtime.normalizeLedgerDate(pointRecord?.date);
        const tickerSummaries = runtime.applyInvestmentAggregatePnlAvailability(
            runtime.buildTickerSummaries(
                pointTransactions,
                pointPrices,
                pointEquity,
                runtime.state.investmentTickerClosePricesCache,
                {
                    useAuthoritativePositionSnapshot: false,
                    useAuthoritativePerformanceSnapshot: false,
                    valuationDate: pointDate,
                },
            ),
        );
        // Realized coverage and open-position valuation are independent.
        const realizedPnl = runtime.isInvestmentAggregatePnlUnavailable(tickerSummaries)
            ? null
            : runtime.getInvestmentHistoricalRealizedPnl(pointTransactions, tickerSummaries, pointDate);
        const openPositions = tickerSummaries.filter((summary) => summary?.hasOpenPosition);
        const unrealizedComplete = openPositions.every((summary) => (
            summary?.pnlUnavailable !== true
            && summary?.unrealizedPnlStatus === 'complete'
            && runtime.getOptionalInvestmentNumber(summary?.unrealizedPnl) !== null
        ));
        const unrealizedPnl = unrealizedComplete
            ? openPositions.reduce((sum, summary) => sum + summary.unrealizedPnl, 0)
            : null;
        const metrics = buildInvestmentChartPnlMetrics(realizedPnl, unrealizedPnl);
        runtime.state.investmentChartPnlMetricsByPoint.set(pointRecord, metrics);
        return metrics;
    }

function resolveInvestmentChartPnlMetrics(pointRecord, {useCurrentHoldings = false} = {}) {
        if (useCurrentHoldings) {
            return runtime.state.investmentCurrentChartPnlMetrics || {
                realizedPnl: null,
                unrealizedPnl: null,
                cumulativePnl: null,
            };
        }
        return buildInvestmentHistoricalChartPnlMetrics(pointRecord);
    }

function cancelInvestmentChartPnlResolution() {
        if (runtime.state.investmentChartPnlResolveTimer) {
            window.clearTimeout(runtime.state.investmentChartPnlResolveTimer);
            runtime.state.investmentChartPnlResolveTimer = 0;
        }
        runtime.state.investmentChartPnlResolveSerial += 1;
    }

function buildInvestmentEquityChartRenderState(chartPoints = [], overviewIntradayLinePoints = []) {
        const useOverviewIntradayLineRequested = runtime.isInvestmentOverviewIntradayEquityRange();
        const preparedChartPoints = (Array.isArray(chartPoints) ? chartPoints : [])
            .filter((point) => useOverviewIntradayLineRequested
                ? point?.is_realtime !== true && point?.is_calendar_carry_forward !== true
                : true);
        const normalizedChartPoints = useOverviewIntradayLineRequested
            ? preparedChartPoints
            : runtime.ensureInvestmentLiveSessionChartSlot(preparedChartPoints);
        const sortedChartPoints = (useOverviewIntradayLineRequested
            ? normalizedChartPoints
            : runtime.dedupeInvestmentChartPointsByLedgerDate(normalizedChartPoints))
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        runtime.setInvestmentSharedChartDateRange(sortedChartPoints);
        const fullChartPointIndexByLedgerNo = new Map();
        sortedChartPoints.forEach((point, index) => {
            const ledgerNos = Array.isArray(point?.anchor_ledger_nos) ? point.anchor_ledger_nos : [];
            ledgerNos.forEach((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                if (!Number.isFinite(normalizedLedgerNo) || normalizedLedgerNo <= 0) return;
                fullChartPointIndexByLedgerNo.set(normalizedLedgerNo, index);
            });
        });
        const visibleRangeLabels = new Set(runtime.getInvestmentEquityRangeLabels(
            sortedChartPoints.map((point) => point.date),
            runtime.state.selectedInvestmentEquityRange,
        ));
        const visibleChartPointEntries = sortedChartPoints
            .map((point, sourceIndex) => ({ point, sourceIndex }))
            .filter(({ point }) => (
                !visibleRangeLabels.size
                || visibleRangeLabels.has(runtime.normalizeLedgerDate(point?.date))
            ));
        const allPointEntries = sortedChartPoints.map((point, sourceIndex) => ({ point, sourceIndex }));
        const firstLedgerAnchoredPointSourceIndex = allPointEntries.findIndex(({ point }) => (
            Array.isArray(point?.anchor_ledger_nos)
            && point.anchor_ledger_nos.some((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                return Number.isFinite(normalizedLedgerNo) && normalizedLedgerNo > 0;
            })
        ));
        const visiblePoints = visibleRangeLabels.size
            ? visibleChartPointEntries
            : allPointEntries;
        const renderableVisiblePoints = visiblePoints.filter(({ sourceIndex }) => (
            firstLedgerAnchoredPointSourceIndex < 0
            || sourceIndex >= firstLedgerAnchoredPointSourceIndex
        ));
        const visibleChartPoints = renderableVisiblePoints.map(({ point }) => point);
        const visiblePointSourceIndexes = renderableVisiblePoints.map(({ sourceIndex }) => sourceIndex);
        const normalizedIntradayLinePoints = runtime.mergeInvestmentOverviewRealtimeLinePoints(
            (Array.isArray(overviewIntradayLinePoints) ? overviewIntradayLinePoints : [])
            .map((entry) => ({
                date: String(entry?.date || ''),
                equity: entry?.equity !== null && entry?.equity !== undefined && Number.isFinite(Number(entry.equity))
                    ? roundInvestmentChartCurrencyValue(entry.equity)
                    : null,
                point: entry?.point || null,
            }))
            .filter((entry) => entry.date),
        );
        const useOverviewIntradayLine = runtime.isInvestmentOverviewIntradayEquityRange()
            && normalizedIntradayLinePoints.length >= 390;
        const rawDates = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map((entry) => entry.date)
            : visibleChartPoints.map((point) => point.date);
        const equity = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map((entry) => entry.equity)
            : visibleChartPoints.map((point) => roundInvestmentChartCurrencyValue(point.aggregate_total_equity ?? point.total_equity));
        const historicalEquity = useOverviewIntradayLine
            ? normalizedIntradayLinePoints
                .map((entry) => entry.equity)
                .filter((value) => Number.isFinite(value))
            : visibleChartPoints
            .filter((point) => point?.is_realtime !== true)
            .map((point) => roundInvestmentChartCurrencyValue(point.aggregate_total_equity ?? point.total_equity))
            .filter((value) => Number.isFinite(value));
        const renderedVisibleChartPoints = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map((entry) => entry.point || {
                date: entry.date,
                aggregate_total_equity: entry.equity,
                total_equity: entry.equity,
                anchor_ledger_date: '',
                anchor_ledger_nos: [],
            })
            : visibleChartPoints;
        const renderedVisiblePointSourceIndexes = useOverviewIntradayLine
            ? normalizedIntradayLinePoints.map(() => -1)
            : visiblePointSourceIndexes;
        const visibleChartPointIndexByLedgerNo = new Map();
        visibleChartPoints.forEach((point, index) => {
            const ledgerNos = Array.isArray(point?.anchor_ledger_nos) ? point.anchor_ledger_nos : [];
            ledgerNos.forEach((ledgerNo) => {
                const normalizedLedgerNo = Number(ledgerNo);
                if (!Number.isFinite(normalizedLedgerNo) || normalizedLedgerNo <= 0) return;
                visibleChartPointIndexByLedgerNo.set(normalizedLedgerNo, index);
            });
        });
        return {
            sortedChartPoints,
            fullChartPointIndexByLedgerNo,
            visibleChartPoints: renderedVisibleChartPoints,
            visiblePointSourceIndexes: renderedVisiblePointSourceIndexes,
            visibleChartPointIndexByLedgerNo,
            rawDates,
            labels: [...rawDates],
            equity,
            historicalEquity,
            overviewIntradayLinePoints: useOverviewIntradayLine ? normalizedIntradayLinePoints : [],
            latestChartPoint: sortedChartPoints[sortedChartPoints.length - 1] || null,
        };
    }

function syncInvestmentEquityChartCaches(chartState) {
        runtime.state.investmentChartPointsCache = Array.isArray(chartState?.sortedChartPoints) ? chartState.sortedChartPoints : [];
        runtime.state.investmentChartPointIndexByLedgerNo = chartState?.fullChartPointIndexByLedgerNo instanceof Map
            ? chartState.fullChartPointIndexByLedgerNo
            : new Map();
        runtime.state.investmentLatestChartPoint = chartState?.latestChartPoint || null;
        runtime.state.activeChartTooltipPointIndex = -1;
        runtime.state.activeChartTooltipPointRecord = null;
    }

function syncInvestmentEquityChartRealtime(chartPoints = []) {
        if (!runtime.state.investmentEquityChartInstance || !window.Chart) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }
        if (
            runtime.isInvestmentOverviewIntradayEquityRange()
            || runtime.state.investmentEquityChartRuntimeState?.overviewIntradayLinePoints?.length
        ) {
            const baseIntradayLinePoints = runtime.getCachedInvestmentOverviewIntradayLinePoints();
            if (baseIntradayLinePoints.length) {
                applyInvestmentOverviewIntradayLinePoints(chartPoints, baseIntradayLinePoints);
            }
            return;
        }
        const canvas = runtime.state.investmentEquityChartInstance.canvas;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }
        const previousRuntimeState = runtime.state.investmentEquityChartRuntimeState || {};
        const nextChartState = buildInvestmentEquityChartRenderState(chartPoints);
        const previousLabels = Array.isArray(previousRuntimeState.labels) ? previousRuntimeState.labels : [];
        const nextLabels = Array.isArray(nextChartState.labels) ? nextChartState.labels : [];
        const labelsStable = previousLabels.length === nextLabels.length
            && previousLabels.every((label, index) => label === nextLabels[index]);
        const chartYPaddingPx = 5;
        const nextYScale = labelsStable && previousRuntimeState.frozenYScale
            ? previousRuntimeState.frozenYScale
            : buildPixelPaddedInvestmentEquityYScale(
                canvas,
                nextChartState.historicalEquity.length ? nextChartState.historicalEquity : nextChartState.equity,
                chartYPaddingPx,
            );
        runtime.state.investmentEquityChartRuntimeState = {
            ...nextChartState,
            frozenYScale: nextYScale,
            realtimeMarkerElement: previousRuntimeState.realtimeMarkerElement || null,
        };
        syncInvestmentEquityChartCaches(runtime.state.investmentEquityChartRuntimeState);
        if (!labelsStable) {
            runtime.state.investmentEquityChartInstance.data.labels = [...runtime.state.investmentEquityChartRuntimeState.labels];
            runtime.state.investmentEquityChartInstance.data.rawLabels = [...runtime.state.investmentEquityChartRuntimeState.rawDates];
        }
        if (Array.isArray(runtime.state.investmentEquityChartInstance.data.datasets) && runtime.state.investmentEquityChartInstance.data.datasets[0]) {
            runtime.state.investmentEquityChartInstance.data.datasets[0].data = [...runtime.state.investmentEquityChartRuntimeState.equity];
        }
        const yScale = runtime.state.investmentEquityChartInstance.options?.scales?.y;
        if (yScale && !labelsStable) {
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
        }
        runtime.state.investmentEquityChartInstance.update('none');
    }

function applyInvestmentEquityRangeChange(chartPoints = []) {
        if (!runtime.state.investmentEquityChartInstance || !window.Chart) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }
        const canvas = runtime.state.investmentEquityChartInstance.canvas;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) {
            renderEquityChartWithEquity(chartPoints);
            return;
        }

        if (!runtime.isInvestmentOverviewIntradayEquityRange()) {
            runtime.state.investmentOverviewIntradayRenderSerial += 1;
        }

        const cachedOverviewIntradayLinePoints = runtime.isInvestmentOverviewIntradayEquityRange()
            ? runtime.getCachedInvestmentOverviewIntradayLinePoints()
            : [];
        const initialOverviewIntradayLinePoints = runtime.isInvestmentOverviewIntradayEquityRange()
            ? (cachedOverviewIntradayLinePoints.length
                ? cachedOverviewIntradayLinePoints
                : runtime.buildInvestmentOverviewEmptyIntradayLinePoints())
            : [];

        const previousRuntimeState = runtime.state.investmentEquityChartRuntimeState || {};
        const nextChartState = buildInvestmentEquityChartRenderState(chartPoints, initialOverviewIntradayLinePoints);
        const chartYPaddingPx = 5;
        const nextYScale = buildPixelPaddedInvestmentEquityYScale(
            canvas,
            nextChartState.historicalEquity.length ? nextChartState.historicalEquity : nextChartState.equity,
            chartYPaddingPx,
        );
        const realtimeMarkerElement = previousRuntimeState.realtimeMarkerElement
            || canvas.closest('.investment-equity-chart-stage')?.querySelector('[data-investment-equity-live-marker]');

        runtime.state.investmentEquityChartRuntimeState = {
            ...nextChartState,
            frozenYScale: nextYScale,
            realtimeMarkerElement: realtimeMarkerElement instanceof HTMLElement ? realtimeMarkerElement : null,
        };
        syncInvestmentEquityChartCaches(runtime.state.investmentEquityChartRuntimeState);
        runtime.state.investmentEquityChartInstance.data.labels = [...runtime.state.investmentEquityChartRuntimeState.labels];
        runtime.state.investmentEquityChartInstance.data.rawLabels = [...runtime.state.investmentEquityChartRuntimeState.rawDates];
        const dataset = runtime.state.investmentEquityChartInstance.data.datasets?.[0];
        if (dataset) {
            dataset.data = [...runtime.state.investmentEquityChartRuntimeState.equity];
            dataset.showLine = true;
            dataset.spanGaps = false;
            dataset.borderColor = "#0055cc";
            dataset.segment = {
                borderColor: (context) => runtime.getInvestmentEquitySegmentBorderColor(context, "#0055cc"),
            };
        }
        const yScale = runtime.state.investmentEquityChartInstance.options?.scales?.y;
        if (yScale) {
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
        }
        runtime.state.investmentEquityChartInstance.update('none');
        if (runtime.isInvestmentOverviewIntradayEquityRange()) {
            scheduleInvestmentOverviewIntradayLinePoints(chartPoints);
        }
    }

function updateInvestmentEquityChartDisplay(chartPoints = []) {
        const inputPoints = Array.isArray(chartPoints) ? chartPoints : [];
        if (!inputPoints.length) {
            renderEquityChartWithEquity(inputPoints);
            return;
        }
        if (runtime.state.investmentEquityChartInstance?.canvas?.isConnected) {
            applyInvestmentEquityRangeChange(inputPoints);
            return;
        }
        renderEquityChartWithEquity(inputPoints);
    }

function applyInvestmentOverviewIntradayLinePoints(chartPoints = [], overviewIntradayLinePoints = []) {
        if (!runtime.state.investmentEquityChartInstance || !window.Chart) return;
        const canvas = runtime.state.investmentEquityChartInstance.canvas;
        if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) return;
        runtime.cacheInvestmentOverviewIntradayLinePoints(overviewIntradayLinePoints);
        const nextChartState = buildInvestmentEquityChartRenderState(chartPoints, overviewIntradayLinePoints);
        if (!nextChartState.overviewIntradayLinePoints.length) return;
        const chartYPaddingPx = 5;
        const nextYScale = buildPixelPaddedInvestmentEquityYScale(
            canvas,
            nextChartState.historicalEquity.length ? nextChartState.historicalEquity : nextChartState.equity,
            chartYPaddingPx,
        );
        runtime.state.investmentEquityChartRuntimeState = {
            ...nextChartState,
            frozenYScale: nextYScale,
            realtimeMarkerElement: runtime.state.investmentEquityChartRuntimeState?.realtimeMarkerElement || null,
        };
        syncInvestmentEquityChartCaches(runtime.state.investmentEquityChartRuntimeState);
        runtime.state.investmentEquityChartInstance.data.labels = [...runtime.state.investmentEquityChartRuntimeState.labels];
        runtime.state.investmentEquityChartInstance.data.rawLabels = [...runtime.state.investmentEquityChartRuntimeState.rawDates];
        if (Array.isArray(runtime.state.investmentEquityChartInstance.data.datasets) && runtime.state.investmentEquityChartInstance.data.datasets[0]) {
            runtime.state.investmentEquityChartInstance.data.datasets[0].data = [...runtime.state.investmentEquityChartRuntimeState.equity];
            runtime.state.investmentEquityChartInstance.data.datasets[0].showLine = true;
            runtime.state.investmentEquityChartInstance.data.datasets[0].spanGaps = false;
            runtime.state.investmentEquityChartInstance.data.datasets[0].borderColor = "#0055cc";
            runtime.state.investmentEquityChartInstance.data.datasets[0].segment = {
                borderColor: (context) => runtime.getInvestmentEquitySegmentBorderColor(context, "#0055cc"),
            };
        }
        const yScale = runtime.state.investmentEquityChartInstance.options?.scales?.y;
        if (yScale) {
            yScale.min = nextYScale.min;
            yScale.max = nextYScale.max;
        }
        runtime.state.investmentEquityChartInstance.update('none');
    }

function scheduleInvestmentOverviewIntradayLinePoints(chartPoints = []) {
        const requestSerial = ++runtime.state.investmentOverviewIntradayRenderSerial;
        if (!runtime.isInvestmentOverviewIntradayEquityRange()) return;
        const normalizedRange = runtime.normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange);
        const requestedDayCount = runtime.getInvestmentOverviewIntradayDayCount(normalizedRange);
        const readiness = requestedDayCount
            ? runtime.refreshInvestmentMarketSessionState({ dayCount: requestedDayCount, force: true })
            : Promise.resolve(runtime.state.investmentMarketSessionState);
        readiness.then(() => {
            if (requestSerial !== runtime.state.investmentOverviewIntradayRenderSerial) return;
            if (!runtime.isInvestmentOverviewIntradayEquityRange()) return;
            return runtime.buildInvestmentOverviewIntradayLinePoints();
        }).then((linePoints) => {
            if (requestSerial !== runtime.state.investmentOverviewIntradayRenderSerial) return;
            if (!runtime.isInvestmentOverviewIntradayEquityRange()) return;
            if (!Array.isArray(linePoints) || linePoints.length < 390) return;
            const cachedLinePoints = runtime.getCachedInvestmentOverviewIntradayLinePoints();
            if (
                cachedLinePoints.length
                && !runtime.shouldUseInvestmentOverviewIntradayLinePoints(linePoints, cachedLinePoints)
            ) {
                applyInvestmentOverviewIntradayLinePoints(chartPoints, cachedLinePoints);
                return;
            }
            if (
                !cachedLinePoints.length
                && !runtime.getInvestmentOverviewIntradayLineQuality(linePoints).isHealthy
            ) {
                return;
            }
            applyInvestmentOverviewIntradayLinePoints(chartPoints, linePoints);
        }).catch((error) => {
            console.warn(error);
        });
    }

function buildPixelPaddedInvestmentEquityYScale(canvas, dataset = [], paddingPx = 0) {
        const values = (Array.isArray(dataset) ? dataset : [])
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value));
        if (!values.length) return {};
        const rawMin = Math.min(...values);
        const rawMax = Math.max(...values);
        if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return {};
        if (rawMin === rawMax) {
            const fallbackPadding = Math.abs(rawMin || 1) * 0.02 || 1;
            return {
                min: rawMin - fallbackPadding,
                max: rawMax + fallbackPadding,
                rawMin,
                rawMax,
            };
        }
        const canvasHeight = Math.max(canvas?.clientHeight || 0, 80);
        const safePaddingPx = Math.max(0, paddingPx);
        const peakGuardValue = canvas instanceof HTMLCanvasElement
            ? window.getComputedStyle(canvas.closest('.investment-chart-stack') || canvas)
                .getPropertyValue('--investment-equity-peak-guard')
            : '';
        const peakGuardPx = Math.max(0, Number.parseFloat(peakGuardValue) || 5);
        const topPaddingPx = safePaddingPx + peakGuardPx;
        const usableHeight = Math.max(canvasHeight - safePaddingPx - topPaddingPx, 1);
        const dataRange = rawMax - rawMin;
        const bottomDataPadding = dataRange * (safePaddingPx / usableHeight);
        const topDataPadding = dataRange * (topPaddingPx / usableHeight);
        return {
            min: rawMin - bottomDataPadding,
            max: rawMax + topDataPadding,
            rawMin,
            rawMax,
        };
    }

function renderEquityChartWithEquity(chartPoints) {
        const container = document.getElementById('investment_equity_chart');
        if (!chartPoints.length || !window.Chart) {
            runtime.clearInvestmentEquityRangeControlBindings();
            if (runtime.state.investmentEquityChartInstance) {
                runtime.state.investmentEquityChartInstance.destroy();
                runtime.state.investmentEquityChartInstance = null;
            }
            runtime.state.investmentEquityChartRuntimeState = null;
            runtime.setInvestmentChartReady(false);
            if (runtime.state.investmentAggregateSecurityTransferState.blocked && container) {
                container.innerHTML = `<div class="investment-holdings-empty">${runtime.escapeHtml(runtime.getInvestmentAggregateSecurityTransferBlockedMessage())}</div>`;
            }
            console.warn('Chart.js not available');
            return;
        }

        if (!container) {
            runtime.clearInvestmentEquityRangeControlBindings();
            if (runtime.state.investmentEquityChartInstance) {
                runtime.state.investmentEquityChartInstance.destroy();
                runtime.state.investmentEquityChartInstance = null;
            }
            runtime.state.investmentEquityChartRuntimeState = null;
            runtime.setInvestmentChartReady(false);
            console.warn('Chart container not found');
            return;
        }

        runtime.clearInvestmentEquityRangeControlBindings();
        container.innerHTML = `${runtime.renderInvestmentEquityRangeControl()}<div class="investment-equity-chart-stage"><canvas id="investmentEquityChart"></canvas><div class="trade-chart-hover-line investment-equity-hover-line" data-investment-equity-hover-line aria-hidden="true"></div><div class="trade-chart-hover-date-label investment-equity-hover-date-label" data-investment-equity-hover-date-label aria-hidden="true" hidden><span data-investment-hover-date-line="primary"></span><span data-investment-hover-date-line="secondary"></span></div><div class="investment-equity-live-marker" data-investment-equity-live-marker hidden aria-hidden="true"><span class="investment-equity-live-marker-ring investment-equity-live-marker-ring-outer"></span><span class="investment-equity-live-marker-ring investment-equity-live-marker-ring-inner"></span><span class="investment-equity-live-marker-core"></span></div></div>`;
        const canvas = document.getElementById('investmentEquityChart');
        const chartStage = container.querySelector('.investment-equity-chart-stage');
        const hoverLine = container.querySelector('[data-investment-equity-hover-line]');
        const hoverDateLabel = container.querySelector('[data-investment-equity-hover-date-label]');
        const realtimeMarkerElement = container.querySelector('[data-investment-equity-live-marker]');
        const existingChart = window.Chart.getChart?.(canvas);
        if (existingChart) existingChart.destroy();
        if (runtime.state.investmentEquityChartInstance) {
            runtime.state.investmentEquityChartInstance.destroy();
            runtime.state.investmentEquityChartInstance = null;
        }
        runtime.state.investmentEquityChartRuntimeState = null;
        runtime.setInvestmentChartReady(false, canvas);

        const seriesLineWidth = typeof runtime.chartAxis.readPxToken === 'function'
            ? runtime.chartAxis.readPxToken(container, '--trade-chart-series-line-width', 2.0)
            : 2.0;
        const cachedOverviewIntradayLinePoints = runtime.isInvestmentOverviewIntradayEquityRange()
            ? runtime.getCachedInvestmentOverviewIntradayLinePoints()
            : [];
        const initialOverviewIntradayLinePoints = runtime.isInvestmentOverviewIntradayEquityRange()
            ? (cachedOverviewIntradayLinePoints.length
                ? cachedOverviewIntradayLinePoints
                : runtime.buildInvestmentOverviewEmptyIntradayLinePoints())
            : [];
        const chartState = buildInvestmentEquityChartRenderState(chartPoints, initialOverviewIntradayLinePoints);
        syncInvestmentEquityChartCaches(chartState);

        const getOverviewYAxisWidth = (scale) => {
            const axisMeasurementContext = scale?.ctx || canvas.getContext('2d');
            if (!axisMeasurementContext) return 52;
            axisMeasurementContext.save();
            axisMeasurementContext.font = `400 12px ${getComputedStyle(document.body).fontFamily}`;
            const chartValues = scale?.chart?.data?.datasets?.[0]?.data || chartState.equity;
            const widestEquityLabelWidth = chartValues.reduce((widestWidth, value) => {
                const numericValue = Number(value);
                if (!Number.isFinite(numericValue)) return widestWidth;
                return Math.max(
                    widestWidth,
                    axisMeasurementContext.measureText(runtime.formatHoldingsMoney(numericValue)).width,
                );
            }, 0);
            axisMeasurementContext.restore();
            return Math.max(52, Math.ceil(widestEquityLabelWidth + 16));
        };

        // Read theme tokens
        const resolvedTheme = runtime.resolveInvestmentTheme();
        const equitySeriesColor = "#0055cc";

        let activeChartHoverDate = "";
        let activeTooltipDataIndex = -1;
        let activeTooltipPointRecord = null;
        let activeTooltipPnlMetricsRevision = -1;
        let tooltipElement = null;
        let tooltipWidth = 0;
        let tooltipHeight = 0;
        let tooltipCanvasRect = null;
        let tooltipDonutRect = null;
        let tooltipLayoutViewportKey = "";
        let tooltipAnchorKey = "";
        let investmentHoverFrameId = null;
        let pendingInvestmentHover = null;
        let activeInvestmentHoverIndex = -1;
        let investmentHoverPointCacheKey = "";
        let investmentHoverPointCache = [];
        const getRuntimeState = () => runtime.state.investmentEquityChartRuntimeState || chartState;

        cancelInvestmentChartPnlResolution();

        const formatMoney = (value) => {
            const numericValue = runtime.getOptionalInvestmentNumber(value);
            if (numericValue === null) return '--';
            return new Intl.NumberFormat("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(numericValue);
        };

        const parseRawDate = (value) => {
            if (typeof value !== "string") return null;
            const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
            if (!match) return null;
            return {
                year: Number(match[1]),
                monthIndex: Number(match[2]) - 1,
                day: Number(match[3]),
                hours: match[4] ? Number(match[4]) : null,
                minutes: match[5] ? Number(match[5]) : null,
            };
        };

        const formatChartDateLines = (dateParts) => {
            const axisDateParts = runtime.isInvestmentOverviewHighPrecisionEquityRange()
                ? {...dateParts, hours: null, minutes: null}
                : dateParts;
            return runtime.formatInvestmentFullDateLines(axisDateParts, { allowWrap: true });
        };

        const hoverGuidePlugin = {
            id: "investmentHoverGuidePlugin",
            afterDatasetsDraw(chartInstance) {
                const {ctx, chartArea, scales, tooltip} = chartInstance;
                if (!chartArea || !tooltip || tooltip.opacity === 0) {
                    chartInstance._activeInvestmentEquityHorizontalGuideBounds = null;
                    return;
                }
                const x = tooltip.caretX;
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) {
                    chartInstance._activeInvestmentEquityHorizontalGuideBounds = null;
                    return;
                }
                const pointIndex = tooltip.dataPoints?.[0]?.dataIndex ?? -1;
                const pointEquity = Number(chartInstance.data?.datasets?.[0]?.data?.[pointIndex]);
                const yScale = scales?.y;
                const y = Number(yScale?.getPixelForValue(pointEquity));
                if (
                    !yScale
                    || !Number.isFinite(pointEquity)
                    || !Number.isFinite(y)
                    || y < chartArea.top
                    || y > chartArea.bottom
                ) {
                    chartInstance._activeInvestmentEquityHorizontalGuideBounds = null;
                    chartInstance._activeInvestmentEquityGuideBounds = null;
                    return;
                }
                chartInstance._activeInvestmentEquityHorizontalGuideBounds = {
                    left: chartArea.left,
                    right: chartArea.right,
                    y,
                };
                ctx.save();
                ctx.strokeStyle = resolvedTheme.mutedSoft;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(chartArea.left, y);
                ctx.lineTo(chartArea.right, y);
                ctx.stroke();
                ctx.restore();
                const formattedEquity = runtime.state.investmentShareMaskEnabled
                    ? '***'
                    : runtime.formatHoldingsMoney(pointEquity);
                runtime.drawInvestmentYAxisValueBadge(chartInstance, {
                    y,
                    value: pointEquity,
                    formattedValue: formattedEquity,
                    formatTickLabel: (tickValue) => new Intl.NumberFormat('en-US', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                    }).format(Number(tickValue)),
                    fillColor: resolvedTheme.accentPrimary,
                    boundsProperty: '_activeInvestmentEquityGuideBounds',
                    boundsAliases: {formattedEquity, equity: pointEquity},
                });
            },
        };

        const syncHoldingsMarkerPoint = (targetPoint) => {
            if (!targetPoint) {
                runtime.state.animatedHoldingsMarkerPoint = null;
                return;
            }
            const normalizedTarget = {
                x: Number(targetPoint.x),
                y: Number(targetPoint.y),
            };
            if (!Number.isFinite(normalizedTarget.x) || !Number.isFinite(normalizedTarget.y)) return;
            runtime.state.animatedHoldingsMarkerPoint = normalizedTarget;
        };

        const holdingsHoverMarkerPlugin = {
            id: "investmentHoldingsHoverMarkerPlugin",
            afterDatasetsDraw(chartInstance) {
                const ledgerNo = Number(runtime.state.activeHoldingsHoverLedgerNo);
                if (!Number.isFinite(ledgerNo) || ledgerNo <= 0) {
                    syncHoldingsMarkerPoint(null);
                    return;
                }
                const runtimeState = getRuntimeState();
                const pointIndex = runtimeState.visibleChartPointIndexByLedgerNo.get(ledgerNo);
                if (!Number.isFinite(pointIndex)) return;
                const dataset = chartInstance.data?.datasets?.[0];
                const pointValue = Number(dataset?.data?.[pointIndex]);
                if (!Number.isFinite(pointValue)) return;
                const { ctx, scales, chartArea } = chartInstance;
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!ctx || !xScale || !yScale || !chartArea) return;
                const x = xScale.getPixelForValue(pointIndex);
                const y = yScale.getPixelForValue(pointValue);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) return;
                syncHoldingsMarkerPoint({ x, y });
                const animatedPoint = runtime.state.animatedHoldingsMarkerPoint || { x, y };
                const markerStroke = resolvedTheme.accentPositive || "#16a34a";
                const markerGlow = resolvedTheme.accentPositive || "rgba(22, 163, 74, 0.85)";
                ctx.save();
                ctx.beginPath();
                ctx.arc(animatedPoint.x, animatedPoint.y, holdingsMarkerRadius, 0, Math.PI * 2);
                ctx.lineWidth = holdingsMarkerStrokeWidth;
                ctx.strokeStyle = markerStroke;
                ctx.shadowColor = markerGlow;
                ctx.shadowBlur = 12;
                ctx.stroke();
                ctx.restore();
            },
        };

        const realtimeEndMarkerPlugin = {
            id: "investmentRealtimeEndMarkerPlugin",
            afterDatasetsDraw(chartInstance) {
                const runtimeState = getRuntimeState();
                const markerElement = runtimeState?.realtimeMarkerElement;
                if (!(markerElement instanceof HTMLElement)) return;
                const markerTarget = runtime.resolveInvestmentEquityRealtimeMarkerTarget(runtimeState);
                if (!markerTarget || !Number.isInteger(markerTarget.index) || markerTarget.index < 0) {
                    markerElement.hidden = true;
                    return;
                }
                if (!runtime.shouldRunInvestmentRealtimeQuotes()) {
                    markerElement.hidden = true;
                    return;
                }
                const realtimeIndex = markerTarget.index;
                if (!runtime.shouldShowInvestmentRealtimePulse(markerTarget.session)) {
                    markerElement.hidden = true;
                    return;
                }
                if (!runtime.isRealtimeQuotePulseProviderEligible({
                    market: 'US',
                    session: markerTarget.session,
                    source: markerTarget.source,
                })) {
                    markerElement.hidden = true;
                    return;
                }
                const dataset = chartInstance.data?.datasets?.[0];
                const pointValue = Number(dataset?.data?.[realtimeIndex]);
                if (!Number.isFinite(pointValue)) {
                    markerElement.hidden = true;
                    return;
                }
                const { scales, chartArea } = chartInstance;
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!xScale || !yScale || !chartArea) {
                    markerElement.hidden = true;
                    return;
                }
                const x = xScale.getPixelForValue(realtimeIndex);
                const y = yScale.getPixelForValue(pointValue);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    markerElement.hidden = true;
                    return;
                }
                if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) {
                    markerElement.hidden = true;
                    return;
                }
                markerElement.style.left = `${x}px`;
                markerElement.style.top = `${y}px`;
                markerElement.hidden = false;
            },
        };

        const xAxisLabelPlugin = {
            id: "investmentXAxisLabelPlugin",
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                const xScale = scales?.x;
                const runtimeState = getRuntimeState();
                const labels = Array.isArray(runtimeState.labels) ? runtimeState.labels : [];
                const rawDates = Array.isArray(runtimeState.rawDates) ? runtimeState.rawDates : [];
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const tickIndexes = runtime.buildInvestmentAxisTickIndexes(labels, rawDates, viewportWidth, parseRawDate);
                const baselineY = chartArea.bottom;
                const labelOptions = chart.options?.plugins?.investmentXAxisLabels || {};
                const fontSize = Number.parseFloat(labelOptions.fontSize) || 12;
                const lineHeight = Number.parseFloat(labelOptions.lineHeight) || 10;
                const fontWeight = String(labelOptions.fontWeight || '400');
                const fontFamily = String(labelOptions.fontFamily || getComputedStyle(document.body).fontFamily);
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
                ctx.textBaseline = "top";
                tickIndexes.forEach((index, tickIndex) => {
                    const parsedDate = parseRawDate(rawDates[index]);
                    if (!parsedDate) return;
                    const [firstLine, secondLine] = formatChartDateLines(parsedDate);
                    const x = xScale.getPixelForValue(index);
                    if (!Number.isFinite(x)) return;
                    if (tickIndex === 0) ctx.textAlign = "left";
                    else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = "right";
                    else ctx.textAlign = "center";
                    ctx.fillText(firstLine, x, baselineY);
                    ctx.fillText(secondLine, x, baselineY + lineHeight);
                });
                ctx.restore();
            },
        };

        const chartYPaddingPx = 5;
        const equityYScale = buildPixelPaddedInvestmentEquityYScale(
            canvas,
            chartState.historicalEquity.length ? chartState.historicalEquity : chartState.equity,
            chartYPaddingPx,
        );
        const getOrCreateTooltip = () => {
            if (tooltipElement instanceof HTMLElement && tooltipElement.isConnected) return tooltipElement;
            let tooltip = document.querySelector('[data-investment-chart-tooltip="1"]');
            if (tooltip instanceof HTMLElement) {
                tooltipElement = tooltip;
                return tooltipElement;
            }
            tooltip = document.createElement("div");
            tooltip.className = "chart-tooltip";
            tooltip.dataset.investmentChartTooltip = "1";
            tooltip.style.position = "fixed";
            tooltip.style.left = '0px';
            tooltip.style.top = '0px';
            tooltip.innerHTML = '<p class="chart-tooltip-date"></p><div class="chart-tooltip-list"></div>';
            document.body.appendChild(tooltip);
            tooltipElement = tooltip;
            return tooltipElement;
        };

        const formatTooltipDate = (dateParts) => runtime.formatInvestmentFullDateParts(dateParts, {
            includeTime: Number.isFinite(dateParts?.hours) && Number.isFinite(dateParts?.minutes),
        });

        const updateTooltipPnlRows = (tooltipEl, pnlMetrics) => {
            const metricEntries = [
                ['realizedPnl', pnlMetrics?.realizedPnl],
                ['unrealizedPnl', pnlMetrics?.unrealizedPnl],
                ['cumulativePnl', pnlMetrics?.cumulativePnl],
            ];
            metricEntries.forEach(([key, value]) => {
                const row = tooltipEl.querySelector(`[data-investment-tooltip-pnl="${key}"]`);
                const dot = row?.querySelector('.chart-tooltip-dot');
                const valueElement = row?.querySelector('.chart-tooltip-value');
                if (!(valueElement instanceof HTMLElement)) return;
                const numericValue = runtime.getOptionalInvestmentNumber(value);
                valueElement.textContent = numericValue === null
                    ? 'Unavailable'
                    : runtime.formatHoldingsMoney(numericValue);
                valueElement.classList.remove(
                    'investment-holdings-value-positive',
                    'investment-holdings-value-negative',
                );
                const valueClass = numericValue === null ? '' : runtime.getSignedMetricClass(numericValue);
                if (valueClass) valueElement.classList.add(valueClass);
                if (dot instanceof HTMLElement) {
                    dot.style.background = numericValue === null
                        ? resolvedTheme.muted
                        : (numericValue >= 0
                            ? resolvedTheme.accentPositive
                            : resolvedTheme.accentSecondary);
                }
            });
        };

        const scheduleTooltipPnlResolution = (tooltipEl, pointRecord) => {
            cancelInvestmentChartPnlResolution();
            const resolveSerial = runtime.state.investmentChartPnlResolveSerial;
            tooltipEl.dataset.investmentPnlState = 'pending';
            runtime.state.investmentChartPnlResolveTimer = window.setTimeout(() => {
                runtime.state.investmentChartPnlResolveTimer = 0;
                if (
                    resolveSerial !== runtime.state.investmentChartPnlResolveSerial
                    || runtime.state.activeChartTooltipPointRecord !== pointRecord
                    || !tooltipEl.classList.contains('is-visible')
                ) {
                    return;
                }
                const pnlMetrics = buildInvestmentHistoricalChartPnlMetrics(pointRecord);
                if (
                    resolveSerial !== runtime.state.investmentChartPnlResolveSerial
                    || runtime.state.activeChartTooltipPointRecord !== pointRecord
                    || !tooltipEl.classList.contains('is-visible')
                ) {
                    return;
                }
                updateTooltipPnlRows(tooltipEl, pnlMetrics);
                tooltipEl.dataset.investmentPnlState = 'ready';
                tooltipWidth = 0;
                tooltipHeight = 0;
                tooltipAnchorKey = '';
                window.requestAnimationFrame(() => {
                    if (runtime.state.activeChartTooltipPointRecord !== pointRecord) return;
                    runtime.state.investmentEquityChartInstance?.draw();
                });
            }, 48);
        };

        const externalTooltipHandler = ({ chart, tooltip }) => {
            const tooltipEl = getOrCreateTooltip();
            const runtimeState = getRuntimeState();
            const rawDates = Array.isArray(runtimeState.rawDates) ? runtimeState.rawDates : [];
            const visibleChartPoints = Array.isArray(runtimeState.visibleChartPoints) ? runtimeState.visibleChartPoints : [];
            const visiblePointSourceIndexes = Array.isArray(runtimeState.visiblePointSourceIndexes) ? runtimeState.visiblePointSourceIndexes : [];
            const sortedChartPoints = Array.isArray(runtimeState.sortedChartPoints) ? runtimeState.sortedChartPoints : [];
            if (tooltip.opacity === 0) {
                const hadActiveTooltip = activeTooltipDataIndex >= 0 || tooltipEl.classList.contains('is-visible');
                if (!hadActiveTooltip) return;
                tooltipEl.classList.remove("is-visible");
                activeChartHoverDate = "";
                activeTooltipDataIndex = -1;
                activeTooltipPointRecord = null;
                activeTooltipPnlMetricsRevision = -1;
                cancelInvestmentChartPnlResolution();
                tooltipEl.dataset.investmentPnlState = 'idle';
                runtime.state.activeChartTooltipPointIndex = -1;
                runtime.state.activeChartTooltipPointRecord = null;
                runtime.clearInvestmentHistoryHighlights();
                runtime.clearInvestmentStockDetailHighlights();
                runtime.scheduleInvestmentDummyDonutSync();
                runtime.scheduleInvestmentStockDetailsDonutSync();
                tooltipWidth = 0;
                tooltipHeight = 0;
                tooltipCanvasRect = null;
                tooltipDonutRect = null;
                tooltipLayoutViewportKey = "";
                tooltipAnchorKey = "";
                return;
            }

            const pointIndex = tooltip.dataPoints?.[0]?.dataIndex ?? -1;
            const pointRecord = visibleChartPoints[pointIndex];
            const pointChanged = pointIndex !== activeTooltipDataIndex || pointRecord !== activeTooltipPointRecord;
            const realtimeMarkerTarget = runtime.resolveInvestmentEquityRealtimeMarkerTarget(runtimeState);
            const useCurrentHoldingsPnl = realtimeMarkerTarget?.index === pointIndex;
            const pnlMetricsChanged = (
                useCurrentHoldingsPnl
                && activeTooltipPnlMetricsRevision !== runtime.state.investmentCurrentChartPnlMetricsRevision
            );
            const tooltipContentChanged = pointChanged || pnlMetricsChanged;
            activeTooltipDataIndex = pointIndex;
            activeTooltipPointRecord = pointRecord || null;
            activeTooltipPnlMetricsRevision = useCurrentHoldingsPnl
                ? runtime.state.investmentCurrentChartPnlMetricsRevision
                : -1;
            const tooltipDateSource = String(pointRecord?.realtime_timestamp || rawDates[pointIndex] || '');
            const parsedDate = parseRawDate(tooltipDateSource);
            const sourcePointIndex = Number.isFinite(pointIndex) && pointIndex >= 0
                ? Number(visiblePointSourceIndexes[pointIndex])
                : -1;
            runtime.state.activeChartTooltipPointIndex = Number.isFinite(sourcePointIndex) && sourcePointIndex >= 0 ? sourcePointIndex : -1;
            runtime.state.activeChartTooltipPointRecord = pointRecord && typeof pointRecord === 'object' ? pointRecord : null;
            if (tooltipContentChanged) {
                runtime.scheduleInvestmentDummyDonutSync();
                runtime.scheduleInvestmentStockDetailsDonutSync();
                const dateEl = tooltipEl.querySelector(".chart-tooltip-date");
                const listEl = tooltipEl.querySelector(".chart-tooltip-list");
                if (dateEl instanceof HTMLElement) {
                    dateEl.textContent = parsedDate ? formatTooltipDate(parsedDate) : (tooltip.title?.[0] || "");
                }
                const hoveredLedgerDate = String(pointRecord?.anchor_ledger_date || "").slice(0, 10);

                if (hoveredLedgerDate && hoveredLedgerDate !== activeChartHoverDate) {
                    const ledgerNos = Array.isArray(pointRecord?.anchor_ledger_nos)
                        ? pointRecord.anchor_ledger_nos
                        : runtime.getHistoryRowsForLedgerDate(hoveredLedgerDate).map((row) => Number(row.dataset.investmentHistoryRow || 0));
                    runtime.activateInvestmentHistoryRows(ledgerNos, { behavior: "auto", scroll: false });
                    runtime.syncInvestmentStockDetailPreviewRows(ledgerNos, { behavior: 'auto', scroll: false });
                    activeChartHoverDate = hoveredLedgerDate;
                } else if (!hoveredLedgerDate && activeChartHoverDate) {
                    activeChartHoverDate = "";
                    runtime.clearInvestmentHistoryHighlights();
                    runtime.clearInvestmentStockDetailHighlights();
                }

                const tooltipRows = [];
                if (pointRecord) {
                    const pointEquity = runtime.getOptionalInvestmentNumber(
                        pointRecord?.aggregate_total_equity ?? pointRecord?.total_equity,
                    );
                    const pointMarketValue = runtime.getOptionalInvestmentNumber(
                        pointRecord?.aggregate_market_value ?? pointRecord?.market_value,
                    );
                    const pointRunningCash = Number(pointRecord?.aggregate_display_cash ?? pointRecord?.aggregate_running_cash ?? pointRecord?.running_cash) || 0;
                    const cashInAmount = Number(pointRecord?.cash_in_amount);
                    const cashOutAmount = Number(pointRecord?.cash_out_amount);
                    const missingPriceTickers = Array.from(new Set(
                        Array.isArray(pointRecord?.missing_price_tickers)
                            ? pointRecord.missing_price_tickers
                                .map((ticker) => String(ticker || '').trim().toUpperCase())
                                .filter(Boolean)
                            : [],
                    )).sort();
                    tooltipRows.push({
                        label: "Equity",
                        formattedValue: formatMoney(pointEquity),
                        color: equitySeriesColor,
                    });
                    tooltipRows.push({
                        label: "Market value",
                        formattedValue: formatMoney(pointMarketValue),
                        color: resolvedTheme.accentSecondary,
                    });
                    tooltipRows.push({
                        label: "Cash",
                        formattedValue: formatMoney(pointRunningCash),
                        color: resolvedTheme.accentPositive,
                    });
                    if (!Number.isFinite(pointEquity) && missingPriceTickers.length) {
                        tooltipRows.push({
                            label: "Close unavailable",
                            formattedValue: missingPriceTickers.join(', '),
                            color: resolvedTheme.muted,
                        });
                    }
                    if (Number.isFinite(cashInAmount) && cashInAmount > 1e-9) {
                        tooltipRows.push({
                            label: "Cash in",
                            formattedValue: runtime.formatSignedHoldingsMoney(cashInAmount),
                            color: resolvedTheme.accentPositive,
                            valueClass: 'investment-holdings-value-positive',
                        });
                    }
                    if (Number.isFinite(cashOutAmount) && cashOutAmount > 1e-9) {
                        tooltipRows.push({
                            label: "Cash out",
                            formattedValue: runtime.formatSignedHoldingsMoney(-cashOutAmount),
                            color: resolvedTheme.accentSecondary,
                            valueClass: 'investment-holdings-value-negative',
                        });
                    }
                    const cachedHistoricalPnl = useCurrentHoldingsPnl
                        ? null
                        : runtime.state.investmentChartPnlMetricsByPoint.get(pointRecord);
                    const pnlMetrics = useCurrentHoldingsPnl
                        ? resolveInvestmentChartPnlMetrics(pointRecord, {useCurrentHoldings: true})
                        : (cachedHistoricalPnl || buildInvestmentChartPnlMetrics(null, null));
                    if (useCurrentHoldingsPnl || cachedHistoricalPnl) {
                        cancelInvestmentChartPnlResolution();
                        tooltipEl.dataset.investmentPnlState = 'ready';
                    } else {
                        scheduleTooltipPnlResolution(tooltipEl, pointRecord);
                    }
                    [
                        ['Realized P&L', 'realizedPnl', pnlMetrics.realizedPnl],
                        ['Unrealized P&L', 'unrealizedPnl', pnlMetrics.unrealizedPnl],
                        ['Cumulative P&L', 'cumulativePnl', pnlMetrics.cumulativePnl],
                    ].forEach(([label, pnlKey, value]) => {
                        const numericValue = runtime.getOptionalInvestmentNumber(value);
                        tooltipRows.push({
                            label,
                            pnlKey,
                            formattedValue: numericValue === null
                                ? (useCurrentHoldingsPnl || cachedHistoricalPnl ? 'Unavailable' : '--')
                                : runtime.formatHoldingsMoney(numericValue),
                            color: numericValue === null
                                ? resolvedTheme.muted
                                : (numericValue >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary),
                            valueClass: numericValue === null ? '' : runtime.getSignedMetricClass(numericValue),
                        });
                    });
                } else {
                    tooltipRows.push({
                        label: "Equity",
                        formattedValue: formatMoney(tooltip.dataPoints?.[0]?.parsed?.y ?? null),
                        color: equitySeriesColor,
                    });
                }

                if (listEl instanceof HTMLElement) {
                    listEl.innerHTML = tooltipRows.map((row) => `
                        <div class="chart-tooltip-row"${row.pnlKey ? ` data-investment-tooltip-pnl="${row.pnlKey}"` : ''}>
                            <span class="chart-tooltip-dot" style="background:${row.color}"></span>
                            <span></span>
                            <span class="chart-tooltip-label">${row.label}</span>
                            <span class="chart-tooltip-value${row.valueClass ? ` ${row.valueClass}` : ''}">${row.formattedValue}</span>
                        </div>
                    `).join("");
                }
            }

            const padding = 12;
            const gap = 14;
            const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
            const viewportKey = `${viewportWidth}:${viewportHeight}:${window.scrollX}:${window.scrollY}`;
            const anchorKey = `${pointIndex}:${Number(tooltip.caretX).toFixed(2)}:${Number(tooltip.caretY).toFixed(2)}`;
            const layoutChanged = viewportKey !== tooltipLayoutViewportKey;
            const anchorChanged = anchorKey !== tooltipAnchorKey;
            if (!tooltipContentChanged && !layoutChanged && !anchorChanged) return;
            if (layoutChanged || !tooltipCanvasRect) {
                tooltipCanvasRect = chart.canvas.getBoundingClientRect();
                tooltipDonutRect = runtime.investmentDummyChart instanceof HTMLElement
                    ? runtime.investmentDummyChart.getBoundingClientRect()
                    : null;
            }
            if (tooltipContentChanged || layoutChanged || !tooltipWidth || !tooltipHeight) {
                const tooltipRect = tooltipEl.getBoundingClientRect();
                tooltipWidth = tooltipRect.width;
                tooltipHeight = tooltipRect.height;
            }
            const canvasRect = tooltipCanvasRect;
            const anchorX = canvasRect.left + tooltip.caretX;
            const anchorY = canvasRect.top + tooltip.caretY;
            const donutRect = tooltipDonutRect;
            const rightBoundary = donutRect && donutRect.left > padding
                ? Math.min(viewportWidth - padding, donutRect.left - gap)
                : viewportWidth - padding;
            const roomRight = rightBoundary - anchorX;
            const roomLeft = anchorX - padding;
            const preferRight = roomRight >= tooltipWidth + gap || roomRight >= roomLeft;
            let left = preferRight ? anchorX + gap : anchorX - tooltipWidth - gap;
            if (left < padding) left = padding;
            const maxLeft = rightBoundary - tooltipWidth;
            if (left > maxLeft) {
                left = maxLeft;
            }
            if (left < padding) left = padding;
            let top = anchorY - (tooltipHeight / 2);
            if (top < padding) top = padding;
            if (top + tooltipHeight > viewportHeight - padding) {
                top = viewportHeight - tooltipHeight - padding;
            }
            tooltipEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
            tooltipEl.classList.add("is-visible");
            tooltipLayoutViewportKey = viewportKey;
            tooltipAnchorKey = anchorKey;
        };

        const setInvestmentHoverStyleIfChanged = (element, propertyName, value) => {
            if (!(element instanceof HTMLElement)) return;
            if (element.style.getPropertyValue(propertyName) === value) return;
            element.style.setProperty(propertyName, value);
        };

        const hideInvestmentHoverOverlay = () => {
            hoverLine?.classList.remove("is-visible");
            if (hoverDateLabel instanceof HTMLElement) {
                hoverDateLabel.hidden = true;
                hoverDateLabel.classList.remove("is-visible");
            }
        };

        const updateInvestmentHoverDateLabel = (x, top, index, rawDates) => {
            if (
                !(hoverDateLabel instanceof HTMLElement)
                || !Number.isFinite(x)
                || !Number.isFinite(top)
            ) {
                hideInvestmentHoverOverlay();
                return;
            }
            const dateParts = parseRawDate(rawDates[index]);
            if (!dateParts) {
                hideInvestmentHoverOverlay();
                return;
            }
            runtime.chartAxis.updateHoverDateLabel(hoverDateLabel, {
                lines: formatChartDateLines(dateParts),
                x,
                top,
                width: chartStage instanceof HTMLElement ? chartStage.clientWidth : 0,
            });
        };

        const getInvestmentHoverPointCache = (chart) => {
            const points = chart?.getDatasetMeta?.(0)?.data || [];
            const data = chart?.data?.datasets?.[0]?.data || [];
            const cacheKey = `${chart?.width || 0}:${chart?.height || 0}:${data.length}:${points.length}`;
            if (cacheKey === investmentHoverPointCacheKey) return investmentHoverPointCache;
            investmentHoverPointCacheKey = cacheKey;
            investmentHoverPointCache = points
                .map((point, index) => ({
                    index,
                    point,
                    x: Number(point?.x),
                    value: Number(data[index]),
                }))
                .filter((entry) => (
                    Number.isFinite(entry.x)
                    && Number.isFinite(entry.value)
                    && entry.point?.skip !== true
                ));
            return investmentHoverPointCache;
        };

        const resolveNearestInvestmentHoverPoint = (chart, relativeX) => {
            const points = getInvestmentHoverPointCache(chart);
            if (!points.length || !Number.isFinite(relativeX)) return null;
            if (relativeX <= points[0].x) return points[0];
            const lastPoint = points[points.length - 1];
            if (relativeX >= lastPoint.x) return lastPoint;
            let low = 0;
            let high = points.length - 1;
            while (low < high) {
                const midpoint = Math.floor((low + high) / 2);
                if (points[midpoint].x < relativeX) low = midpoint + 1;
                else high = midpoint;
            }
            const rightPoint = points[low];
            const leftPoint = points[Math.max(0, low - 1)];
            return Math.abs(leftPoint.x - relativeX) <= Math.abs(rightPoint.x - relativeX)
                ? leftPoint
                : rightPoint;
        };

        const clearInvestmentChartHover = (chart) => {
            pendingInvestmentHover = null;
            if (investmentHoverFrameId !== null) {
                window.cancelAnimationFrame(investmentHoverFrameId);
                investmentHoverFrameId = null;
            }
            activeInvestmentHoverIndex = -1;
            hideInvestmentHoverOverlay();
            if (!chart || !chart.ctx) return;
            chart.setActiveElements?.([]);
            chart.tooltip?.setActiveElements?.([], {x: 0, y: 0});
            chart.draw?.();
        };

        const renderInvestmentHoverFrame = (chart, pointer) => {
            if (
                !chart
                || !chart.ctx
                || !(canvas instanceof HTMLCanvasElement)
                || !canvas.isConnected
                || !(chartStage instanceof HTMLElement)
            ) return;
            const chartArea = chart.chartArea;
            const canvasRect = canvas.getBoundingClientRect();
            const stageRect = chartStage.getBoundingClientRect();
            const scaleX = chart.width > 0 ? canvasRect.width / chart.width : 0;
            const scaleY = chart.height > 0 ? canvasRect.height / chart.height : 0;
            if (
                !chartArea
                || !(scaleX > 0)
                || !(scaleY > 0)
                || !Number.isFinite(pointer?.clientX)
            ) return;
            const relativeX = (pointer.clientX - canvasRect.left) / scaleX;
            const chartAreaEdgeTolerance = 1;
            if (
                relativeX < chartArea.left - chartAreaEdgeTolerance
                || relativeX > chartArea.right + chartAreaEdgeTolerance
            ) {
                clearInvestmentChartHover(chart);
                return;
            }
            const resolvedPoint = resolveNearestInvestmentHoverPoint(chart, relativeX);
            if (!resolvedPoint) {
                clearInvestmentChartHover(chart);
                return;
            }
            const activePointChanged = resolvedPoint.index !== activeInvestmentHoverIndex;
            activeInvestmentHoverIndex = resolvedPoint.index;
            if (activePointChanged) {
                const activeElement = [{datasetIndex: 0, index: resolvedPoint.index}];
                chart.setActiveElements?.(activeElement);
                chart.tooltip?.setActiveElements?.(activeElement, {
                    x: resolvedPoint.point.x,
                    y: resolvedPoint.point.y,
                });
                chart.draw?.();
            }

            const pointX = Number(resolvedPoint.point.x) * scaleX;
            const lineX = canvasRect.left - stageRect.left + pointX;
            const plotTop = canvasRect.top - stageRect.top + (chartArea.top * scaleY);
            const plotHeight = Math.max(0, (chartArea.bottom - chartArea.top) * scaleY);
            setInvestmentHoverStyleIfChanged(hoverLine, "top", `${plotTop}px`);
            setInvestmentHoverStyleIfChanged(hoverLine, "height", `${plotHeight}px`);
            setInvestmentHoverStyleIfChanged(hoverLine, "--trade-chart-hover-line-x", `${lineX}px`);
            hoverLine?.classList.add("is-visible");
            updateInvestmentHoverDateLabel(
                lineX,
                canvasRect.top - stageRect.top + (chartArea.bottom * scaleY),
                resolvedPoint.index,
                Array.isArray(getRuntimeState().rawDates) ? getRuntimeState().rawDates : [],
            );
        };

        const scheduleInvestmentHover = (clientX, clientY) => {
            pendingInvestmentHover = {clientX, clientY};
            if (investmentHoverFrameId !== null) return;
            investmentHoverFrameId = window.requestAnimationFrame(() => {
                investmentHoverFrameId = null;
                const pointer = pendingInvestmentHover;
                pendingInvestmentHover = null;
                if (!pointer || runtime.state.investmentEquityChartInstance?.canvas !== canvas) return;
                renderInvestmentHoverFrame(runtime.state.investmentEquityChartInstance, pointer);
            });
        };

        const holdingsMarkerRadius = 5;
        const holdingsMarkerStrokeWidth = 2.8;
        const holdingsMarkerSafePadding = Math.ceil(holdingsMarkerRadius + holdingsMarkerStrokeWidth + 2);
        const realtimeMarkerSafePadding = 32;

        runtime.state.investmentEquityChartRuntimeState = {
            ...chartState,
            frozenYScale: equityYScale,
            realtimeMarkerElement: realtimeMarkerElement instanceof HTMLElement ? realtimeMarkerElement : null,
        };

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: holdingsMarkerSafePadding,
                    right: Math.max(holdingsMarkerSafePadding, realtimeMarkerSafePadding),
                    top: Math.max(44, realtimeMarkerSafePadding),
                    bottom: 24,
                },
            },
            events: [],
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false, external: externalTooltipHandler },
                investmentXAxisLabels: {
                    fontSize: 12,
                    fontWeight: '400',
                    fontFamily: getComputedStyle(document.body).fontFamily,
                    lineHeight: 10,
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { display: false },
                },
                y: {
                    bounds: "ticks",
                    grid: { display: false, drawTicks: false },
                    border: { display: false },
                    afterFit: (scale) => {
                        scale.width = getOverviewYAxisWidth(scale);
                    },
                    ticks: {
                        color: resolvedTheme.muted,
                        display: true,
                        padding: 8,
                        callback(value, index, ticks) {
                            if (index === 0 || index === ticks.length - 1) return '';
                            if (runtime.state.investmentShareMaskEnabled) return '***';
                            return typeof this.getLabelForValue === 'function' ? this.getLabelForValue(value) : String(value);
                        },
                    },
                },
            },
        };

        runtime.state.investmentEquityChartInstance = new Chart(canvas, {
            type: "line",
            data: {
                labels: [...chartState.labels],
                rawLabels: [...chartState.rawDates],
                datasets: [
                    {
                        label: "Equity",
                        data: [...chartState.equity],
                        borderColor: equitySeriesColor,
                        borderWidth: seriesLineWidth,
                        pointRadius: 0,
                        tension: 0,
                        showLine: true,
                        spanGaps: false,
                        borderJoinStyle: "round",
                        borderCapStyle: "round",
                        segment: {
                            borderColor: (context) => runtime.getInvestmentEquitySegmentBorderColor(context, equitySeriesColor),
                        },
                    },
                ],
            },
            options: {
                ...commonOptions,
                animation: false,
                scales: {
                    ...commonOptions.scales,
                    x: { ...commonOptions.scales.x, display: false },
                    y: { ...commonOptions.scales.y, ...equityYScale },
                },
            },
            plugins: [hoverGuidePlugin, holdingsHoverMarkerPlugin, realtimeEndMarkerPlugin, xAxisLabelPlugin],
        });
        canvas.addEventListener('mousemove', (event) => {
            if (!canvas.isConnected) return;
            scheduleInvestmentHover(event.clientX, event.clientY);
        });
        canvas.addEventListener('mouseleave', () => {
            clearInvestmentChartHover(runtime.state.investmentEquityChartInstance);
        });
        scheduleInvestmentOverviewIntradayLinePoints(chartPoints);
        if (runtime.state.activeHoldingsHoverLedgerNo > 0) {
            runtime.state.investmentEquityChartInstance.update('none');
        }
        const readyScheduler = window.WorthwardMotion?.scheduler;
        if (readyScheduler?.frame) {
            let readyFrameCount = 0;
            readyScheduler.frame('investment-equity-chart-ready', () => {
                readyFrameCount += 1;
                if (readyFrameCount < 2) return true;
                if (canvas.dataset.investmentChartReady !== '1') runtime.setInvestmentChartReady(true, canvas);
                return false;
            });
        } else {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    if (canvas.dataset.investmentChartReady === '1') return;
                    runtime.setInvestmentChartReady(true, canvas);
                });
            });
        }
        runtime.bindInvestmentEquityRangeControls(chartState.sortedChartPoints);
    }

function formatEventType(type) {
        if (!type) return '';
        return type.split('_').map(word => {
            // Special case capitalization for IBKR transaction types
            const lower = word.toLowerCase();
            if (lower === 'fx') return 'FX';
            if (lower === 'kol') return 'KOL';
            if (lower === 'pnl') return 'P&L';
            return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
    }

    return {
        updateDashboardWithEquity,
        roundInvestmentChartCurrencyValue,
        buildInvestmentChartPnlMetrics,
        setInvestmentCurrentChartPnlMetrics,
        refreshInvestmentChartPnlState,
        getInvestmentChartPnlPointTransactions,
        getInvestmentChartPnlPointPrices,
        buildInvestmentHistoricalChartPnlMetrics,
        resolveInvestmentChartPnlMetrics,
        cancelInvestmentChartPnlResolution,
        buildInvestmentEquityChartRenderState,
        syncInvestmentEquityChartCaches,
        syncInvestmentEquityChartRealtime,
        applyInvestmentEquityRangeChange,
        updateInvestmentEquityChartDisplay,
        applyInvestmentOverviewIntradayLinePoints,
        scheduleInvestmentOverviewIntradayLinePoints,
        buildPixelPaddedInvestmentEquityYScale,
        renderEquityChartWithEquity,
        formatEventType,
    };
}

