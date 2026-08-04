/* Code version: v0.1.12 */
(() => {
    const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
    const dcaThemeState = bootstrap.dcaThemeState = bootstrap.dcaThemeState || {};
    const chartAxis = window.ANTIGRAVITY_CHART_AXIS || {};

    const readThemeTokens = () => (
        typeof chartAxis.readThemeTokens === "function"
            ? chartAxis.readThemeTokens({
                text: "#111111",
                muted: "#8e8e93",
                accentPrimary: "#0055cc",
                accentSecondary: "#ff2f92",
                accentPositive: "#22c55e",
            })
            : (() => {
                const theme = window.ANTIGRAVITY_APP?.theme || {};
                const computed = getComputedStyle(document.body);
                return {
                    text: computed.getPropertyValue("--theme-text").trim() || theme.text || "#111111",
                    muted: computed.getPropertyValue("--theme-muted").trim() || theme.muted || "#8e8e93",
                    accentPrimary: computed.getPropertyValue("--theme-accent-primary").trim() || theme.accent_primary || "#0055cc",
                    accentSecondary: computed.getPropertyValue("--theme-accent-secondary").trim() || theme.accent_secondary || "#ff2f92",
                    accentPositive: computed.getPropertyValue("--theme-accent-positive").trim() || theme.accent_positive || "#22c55e",
                };
            })()
    );

    const bindColorSchemeRefresh = (callback) => {
        if (dcaThemeState.mediaCleanup) {
            dcaThemeState.mediaCleanup();
            dcaThemeState.mediaCleanup = null;
        }
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = () => window.requestAnimationFrame(callback);
        const cleanups = [];
        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", handler);
            cleanups.push(() => media.removeEventListener("change", handler));
        } else if (typeof media.addListener === "function") {
            media.addListener(handler);
            cleanups.push(() => media.removeListener(handler));
        }
        window.addEventListener("antigravity:theme-mode-change", handler);
        cleanups.push(() => window.removeEventListener("antigravity:theme-mode-change", handler));
        dcaThemeState.mediaCleanup = () => cleanups.forEach((cleanup) => cleanup());
        return dcaThemeState.mediaCleanup;
    };

    const buildTableAlignmentSync = (tableShell, scrollContainer, scrollbarVariableName) => {
        if (!(tableShell instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) return null;

        let frameId = 0;
        let resizeObserver = null;

        const syncAlignment = () => {
            frameId = 0;
            const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
            tableShell.style.setProperty(scrollbarVariableName, `${scrollbarWidth}px`);
        };

        const scheduleAlignmentSync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncAlignment);
        };

        scheduleAlignmentSync();
        window.addEventListener("resize", scheduleAlignmentSync);

        if (window.ResizeObserver) {
            resizeObserver = new ResizeObserver(() => {
                scheduleAlignmentSync();
            });
            resizeObserver.observe(tableShell);
            resizeObserver.observe(scrollContainer);
            const bodyTable = scrollContainer.querySelector("table");
            if (bodyTable instanceof HTMLElement) {
                resizeObserver.observe(bodyTable);
            }
        }

        return () => {
            if (frameId) {
                window.cancelAnimationFrame(frameId);
                frameId = 0;
            }
            window.removeEventListener("resize", scheduleAlignmentSync);
            resizeObserver?.disconnect();
            tableShell.style.removeProperty(scrollbarVariableName);
        };
    };

    const buildPixelPaddedYScale = (canvas, datasets, paddingPx) => {
        const values = datasets.flat().filter((value) => Number.isFinite(value));
        if (!values.length || !(canvas instanceof HTMLCanvasElement)) return {};
        const rect = canvas.getBoundingClientRect();
        const height = Math.max(rect.height || canvas.height || 1, 1);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        if (minValue === maxValue) {
            const basePadding = Math.max(Math.abs(minValue) * 0.08, 1);
            return {
                min: minValue - basePadding,
                max: maxValue + basePadding,
            };
        }
        const valueSpan = maxValue - minValue;
        const valuePadding = (valueSpan / height) * Math.max(paddingPx, 0);
        return {
            min: minValue - valuePadding,
            max: maxValue + valuePadding,
        };
    };

    const initDcaWorkspace = () => {
        const state = window.ANTIGRAVITY_APP;
        if (!state || state.currentView !== "dca" || !window.Chart || !state.dcaResult) return;
        if (typeof bootstrap.dcaTableAlignmentCleanup === "function") {
            bootstrap.dcaTableAlignmentCleanup();
            bootstrap.dcaTableAlignmentCleanup = null;
        }

        const priceCanvas = document.getElementById("tradePriceChart");
        const equityCanvas = document.getElementById("tradeEquityChart");
        if (!(priceCanvas instanceof HTMLCanvasElement) || !(equityCanvas instanceof HTMLCanvasElement)) return;

        const existingPriceChart = window.Chart.getChart?.(priceCanvas);
        const existingEquityChart = window.Chart.getChart?.(equityCanvas);
        if (existingPriceChart) existingPriceChart.destroy();
        if (existingEquityChart) existingEquityChart.destroy();

        const resolvedTheme = readThemeTokens();
        const {dcaResult} = state;
        const labels = Array.isArray(dcaResult.chart?.dates) ? dcaResult.chart.dates : [];
        const rawDates = Array.isArray(dcaResult.chart?.raw_dates) ? dcaResult.chart.raw_dates : [];
        const close = Array.isArray(dcaResult.chart?.close) ? dcaResult.chart.close.map((value) => Number(value || 0)) : [];
        const equity = Array.isArray(dcaResult.chart?.equity) ? dcaResult.chart.equity.map((value) => Number(value || 0)) : [];
        const plannedCapital = Number(dcaResult.summary?.planned_capital || 0);
        const allInEquity = Array.isArray(dcaResult.chart?.all_in_equity)
            ? dcaResult.chart.all_in_equity.map((value) => (Number.isFinite(Number(value)) ? Number(value) : null))
            : [];
        const trades = Array.isArray(dcaResult.trades) ? dcaResult.trades : [];
        if (!labels.length || !close.length || !equity.length || !allInEquity.length) return;

        const tradeChartStack = priceCanvas.closest(".trade-chart-stack");
        if (!tradeChartStack) return;
        const chartYPaddingPx = 5;
        const fixedYAxisWidth = 52;
        const contributionByIndex = new Map();
        const indexByDate = new Map();
        rawDates.forEach((value, index) => {
            indexByDate.set(String(value), index);
            const normalized = String(value || "").replace(/-/g, "/");
            indexByDate.set(normalized, index);
        });
        trades.forEach((trade) => {
            const rawTradeDate = String(trade.raw_date || "");
            const index = indexByDate.get(rawTradeDate)
                ?? indexByDate.get(rawTradeDate.replace(/-/g, "/"))
                ?? indexByDate.get(String(trade.date || ""));
            if (!Number.isInteger(index)) return;
            const amount = Number(trade.amount || 0);
            contributionByIndex.set(index, {
                price: Number(trade.price || 0),
                amount,
            });
        });

        const svgMarkerViewBox = {width: 20.3027, height: 20.5176};
        const svgMarkerTip = {x: 9.9707, y: 0.00976562};
        const svgMarkerPath = new Path2D("M19.9414 19.1406C19.9414 18.6914 19.7461 18.3398 19.5117 17.8516L11.4844 1.26953C11.0254 0.332031 10.5859 0.00976562 9.9707 0.00976562C9.36523 0.00976562 8.92578 0.332031 8.45703 1.26953L0.439453 17.8516C0.195312 18.3496 0 18.7012 0 19.1504C0 20 0.634766 20.5176 1.64062 20.5176L18.3105 20.5078C19.3066 20.5078 19.9414 19.9902 19.9414 19.1406Z");

        const formatMoney = (value, digits = 2) => new Intl.NumberFormat("en-US", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        }).format(value);
        const formatReturn = (value) => `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}%`;

        const parseRawDate = (value) => {
            const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return null;
            return `${Number(match[3])} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1]} ${match[1]}`;
        };

        const buildTickIndexSet = (count, plotWidth) => (
            typeof chartAxis.buildTickIndexSet === "function"
                ? chartAxis.buildTickIndexSet(count, plotWidth)
                : (() => {
                    if (count <= 0) return new Set();
                    if (count === 1) return new Set([0]);
                    const maxTickCount = plotWidth >= 768 ? 4 : 3;
                    if (maxTickCount === 3 || count < 4) {
                        return new Set([0, Math.round((count - 1) / 2), count - 1]);
                    }
                    return new Set([
                        0,
                        Math.round((count - 1) / 3),
                        Math.round(((count - 1) * 2) / 3),
                        count - 1,
                    ]);
                })()
        );

        const xAxisLabelPlugin = {
            id: "dcaXAxisLabelPlugin",
            afterDraw(chart) {
                if (chart.canvas !== equityCanvas) return;
                const {ctx, chartArea, scales} = chart;
                const xScale = scales?.x;
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = tradeChartStack.clientWidth || chart.canvas.clientWidth || window.innerWidth || 0;
                const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
                const baselineY = chartArea.bottom;
                const lineHeight = 10;
                ctx.save();
                ctx.fillStyle = resolvedTheme.muted;
                ctx.font = '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
                ctx.textBaseline = "top";
                tickIndexes.forEach((index, tickIndex) => {
                    const rawLabel = String(rawDates[index] || "");
                    const [day, month, year] = (parseRawDate(rawLabel) || labels[index]).split(" ");
                    const x = xScale.getPixelForValue(index);
                    if (!Number.isFinite(x)) return;
                    if (tickIndex === 0) ctx.textAlign = "left";
                    else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = "right";
                    else ctx.textAlign = "center";
                    ctx.fillText(`${day} ${month}`, x, baselineY);
                    ctx.fillText(`${year || ""}`, x, baselineY + lineHeight);
                });
                ctx.restore();
            },
        };

        const contributionMarkerPlugin = {
            id: "dcaContributionMarkerPlugin",
            afterDatasetsDraw(chart) {
                if (chart.canvas !== priceCanvas) return;
                const meta = chart.getDatasetMeta(0);
                const yScale = chart.scales?.y;
                if (!meta?.data?.length || !yScale) return;
                const {ctx} = chart;
                ctx.save();
                ctx.fillStyle = resolvedTheme.accentPrimary;
                contributionByIndex.forEach((marker, index) => {
                    const point = meta.data[index];
                    if (!point || !Number.isFinite(point.x)) return;
                    const y = yScale.getPixelForValue(marker.price);
                    if (!Number.isFinite(y)) return;
                    const sizePx = 8;
                    const scale = sizePx / svgMarkerViewBox.width;
                    ctx.save();
                    ctx.fillStyle = resolvedTheme.accentPositive;
                    ctx.translate(point.x, y);
                    ctx.scale(scale, scale);
                    ctx.translate(-svgMarkerTip.x, -svgMarkerTip.y);
                    ctx.fill(svgMarkerPath);
                    ctx.restore();
                });
                ctx.restore();
            },
        };

        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: "index",
            },
            plugins: {
                legend: {display: false},
                tooltip: {enabled: false},
            },
            scales: {
                x: {
                    display: false,
                    grid: {display: false},
                    border: {display: false},
                },
                y: {
                    grid: {display: false},
                    border: {display: false},
                    afterFit: (scale) => {
                        scale.width = fixedYAxisWidth;
                    },
                    ticks: {
                        color: resolvedTheme.muted,
                        display: true,
                        padding: 8,
                        callback(value) {
                            return formatMoney(Number(value || 0));
                        },
                    },
                },
            },
        };

        const hoverLine = document.createElement("div");
        hoverLine.className = "trade-chart-hover-line";
        tradeChartStack.querySelector(".trade-chart-hover-line")?.remove();
        tradeChartStack.appendChild(hoverLine);

        const tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.innerHTML = `
            <p class="chart-tooltip-date"></p>
            <div class="chart-tooltip-list">
                <div class="chart-tooltip-row"><span class="chart-tooltip-dot"></span><span></span><span class="chart-tooltip-label">Close</span><span class="chart-tooltip-value" data-role="close"></span></div>
                <div class="chart-tooltip-row"><span class="chart-tooltip-dot"></span><span></span><span class="chart-tooltip-label">Net return</span><span class="chart-tooltip-value" data-role="return"></span></div>
                <div class="chart-tooltip-row"><span class="chart-tooltip-dot"></span><span></span><span class="chart-tooltip-label">Equity</span><span class="chart-tooltip-value" data-role="equity"></span></div>
                <div class="chart-tooltip-row"><span class="chart-tooltip-dot"></span><span></span><span class="chart-tooltip-label">If all in</span><span class="chart-tooltip-value" data-role="all-in"></span></div>
                <div class="chart-tooltip-row"><span class="chart-tooltip-dot"></span><span></span><span class="chart-tooltip-label">vs all in</span><span class="chart-tooltip-value" data-role="vs-all-in"></span></div>
            </div>
        `;
        tradeChartStack.querySelector(".chart-tooltip")?.remove();
        tradeChartStack.appendChild(tooltip);

        const priceYScale = buildPixelPaddedYScale(priceCanvas, [close], chartYPaddingPx);
        const equityYScale = buildPixelPaddedYScale(equityCanvas, [equity, allInEquity], chartYPaddingPx);

        const priceChart = new Chart(priceCanvas, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Close",
                    data: close,
                    borderColor: resolvedTheme.accentPrimary,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0,
                }],
            },
            options: {
                ...commonOptions,
                scales: {
                    ...commonOptions.scales,
                    y: {...commonOptions.scales.y, ...priceYScale},
                },
            },
            plugins: [contributionMarkerPlugin],
        });

        const equityChart = new Chart(equityCanvas, {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "Equity",
                        data: equity,
                        borderColor: resolvedTheme.accentPositive,
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0,
                    },
                    {
                        label: "If all in",
                        data: allInEquity,
                        borderColor: resolvedTheme.muted,
                        borderWidth: 1.2,
                        pointRadius: 0,
                        tension: 0,
                    },
                ],
            },
            options: {
                ...commonOptions,
                scales: {
                    ...commonOptions.scales,
                    y: {...commonOptions.scales.y, ...equityYScale},
                },
            },
            plugins: [xAxisLabelPlugin],
        });

        const getDatasetPoint = (chart, index, datasetIndex = 0) => {
            const point = chart?.getDatasetMeta?.(datasetIndex)?.data?.[index];
            return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
        };

        const getRelativePointPosition = (canvas, stackRect, point) => {
            const canvasRect = canvas.getBoundingClientRect();
            return {
                x: canvasRect.left - stackRect.left + point.x,
                y: canvasRect.top - stackRect.top + point.y,
            };
        };

        const updateHoverLineFrame = () => {
            if (!priceChart.chartArea || !equityChart.chartArea) return null;
            const priceCanvasRect = priceCanvas.getBoundingClientRect();
            const equityCanvasRect = equityCanvas.getBoundingClientRect();
            const stackRect = tradeChartStack.getBoundingClientRect();
            const top = priceCanvasRect.top - stackRect.top + priceChart.chartArea.top;
            const bottom = equityCanvasRect.top - stackRect.top + equityChart.chartArea.bottom;
            return {top, bottom};
        };

        let activeRows = [];
        const activateRows = (rows) => {
            activeRows.forEach((row) => row.classList.remove("is-metric-hover-target", "is-metric-hover-active"));
            activeRows = rows;
            rows.forEach((row) => row.classList.add("is-metric-hover-target", "is-metric-hover-active"));
            rows[0]?.scrollIntoView({block: "center", behavior: "smooth"});
        };

        const syncHoverState = (index, sourceCanvas, sourceChart) => {
            if (!Number.isInteger(index)) {
                hoverLine.classList.remove("is-visible");
                tooltip.classList.remove("is-visible");
                activateRows([]);
                return;
            }
            const stackRect = tradeChartStack.getBoundingClientRect();
            const sourcePoint = getDatasetPoint(sourceChart, index, sourceChart === equityChart ? 0 : 0);
            const pricePoint = getDatasetPoint(priceChart, index, 0);
            const canonicalPoint = pricePoint || sourcePoint;
            if (!sourcePoint || !canonicalPoint) return;
            const hoverLinePosition = getRelativePointPosition(priceCanvas, stackRect, canonicalPoint);
            const tooltipAnchor = getRelativePointPosition(sourceCanvas, stackRect, sourcePoint);
            const frame = updateHoverLineFrame();
            if (frame) {
                hoverLine.style.top = `${frame.top}px`;
                hoverLine.style.height = `${Math.max(0, frame.bottom - frame.top)}px`;
            }
            hoverLine.style.left = `${hoverLinePosition.x}px`;
            hoverLine.classList.add("is-visible");

            const equityValue = Number(equity[index] || 0);
            const allInValue = Number(allInEquity[index] || 0);
            const vsAllIn = equityValue - allInValue;
            const netReturn = plannedCapital > 0 ? ((equityValue / plannedCapital) - 1) * 100 : 0;
            tooltip.querySelector(".chart-tooltip-date").textContent = parseRawDate(rawDates[index]) || labels[index];
            tooltip.querySelector('[data-role="close"]').textContent = formatMoney(Number(close[index] || 0), 4);
            tooltip.querySelector('[data-role="return"]').textContent = formatReturn(netReturn);
            tooltip.querySelector('[data-role="equity"]').textContent = formatMoney(equityValue);
            tooltip.querySelector('[data-role="all-in"]').textContent = Number.isFinite(allInValue) && allInValue > 0 ? formatMoney(allInValue) : "--";
            const vsAllInValue = tooltip.querySelector('[data-role="vs-all-in"]');
            vsAllInValue.textContent = Number.isFinite(allInValue) && allInValue > 0
                ? `${vsAllIn >= 0 ? "+" : "-"}${formatMoney(Math.abs(vsAllIn))}`
                : "--";
            vsAllInValue.style.color = vsAllIn >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary;
            const dots = tooltip.querySelectorAll(".chart-tooltip-dot");
            if (dots[0]) dots[0].style.backgroundColor = resolvedTheme.accentPrimary;
            if (dots[1]) dots[1].style.backgroundColor = netReturn >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary;
            if (dots[2]) dots[2].style.backgroundColor = resolvedTheme.accentPositive;
            if (dots[3]) dots[3].style.backgroundColor = resolvedTheme.muted;
            if (dots[4]) dots[4].style.backgroundColor = vsAllIn >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary;
            const tooltipWidth = tooltip.offsetWidth || 220;
            const rightSpace = stackRect.width - hoverLinePosition.x;
            const left = rightSpace >= tooltipWidth + 20
                ? hoverLinePosition.x + 14
                : Math.max(12, hoverLinePosition.x - tooltipWidth - 14);
            const tooltipHeight = tooltip.offsetHeight || 156;
            const padding = 12;
            let top = tooltipAnchor.y - (tooltipHeight / 2);
            if (top < padding) top = padding;
            if (top + tooltipHeight > stackRect.height - padding) top = stackRect.height - tooltipHeight - padding;
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${Math.max(padding, top)}px`;
            tooltip.classList.add("is-visible");

            const rows = Array.from(document.querySelectorAll(`#tradeTransactionsTable tbody tr[data-chart-index="${index}"]`));
            activateRows(rows);
        };

        const resolveNearestIndex = (chart, event) => {
            const points = chart.getDatasetMeta(0)?.data || [];
            const canvasRect = chart.canvas.getBoundingClientRect();
            const relativeX = event.clientX - canvasRect.left;
            let nearestIndex = null;
            let nearestDistance = Number.POSITIVE_INFINITY;
            points.forEach((point, index) => {
                if (!point || !Number.isFinite(point.x)) return;
                const distance = Math.abs(point.x - relativeX);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });
            return nearestIndex;
        };

        const attachHover = (canvas, chart) => {
            canvas.addEventListener("mousemove", (event) => {
                const nearestIndex = resolveNearestIndex(chart, event);
                if (nearestIndex === null) {
                    syncHoverState(null, canvas, chart);
                    return;
                }
                syncHoverState(nearestIndex, canvas, chart);
            });
            canvas.addEventListener("mouseleave", () => {
                syncHoverState(null, canvas, chart);
            });
        };

        const renderContributionTable = () => {
            const table = document.getElementById("tradeTransactionsTable");
            const tbody = table?.querySelector("tbody");
            const nav = document.getElementById("tradeTransactionsPagination");
            const paginationApi = window.ANTIGRAVITY_LOCAL_STORE_PAGINATION;
            if (!tbody || !nav) return;
            if (!paginationApi) {
                window.addEventListener("antigravity:local-store-pagination-ready", renderContributionTable, {once: true});
                return;
            }
            const pageSize = paginationApi.LOCAL_STORE_PAGINATION_DEFAULT_PAGE_SIZE;
            const totalPages = Math.max(1, Math.ceil(trades.length / pageSize));
            let currentPage = 1;

            const renderPage = (page, {animationState = null} = {}) => {
                currentPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
                const start = (currentPage - 1) * pageSize;
                const end = Math.min(start + pageSize, trades.length);
                tbody.innerHTML = "";
                for (let index = start; index < end; index += 1) {
                    const trade = trades[index];
                    const rawTradeDate = String(trade.raw_date || "");
                    const chartIndex = indexByDate.get(rawTradeDate)
                        ?? indexByDate.get(rawTradeDate.replace(/-/g, "/"))
                        ?? indexByDate.get(String(trade.date || ""))
                        ?? "";
                    const row = document.createElement("tr");
                    row.dataset.chartIndex = String(chartIndex);
                    row.innerHTML = `
                        <td class="trade-transactions-index">${index + 1}</td>
                        <td class="trade-transactions-date">${trade.date || ""}</td>
                        <td class="trade-transactions-number">${formatMoney(Number(trade.price || 0), 2)}</td>
                        <td class="trade-transactions-number">${formatMoney(Number(trade.shares || 0), 4)}</td>
                        <td class="trade-transactions-number">${formatMoney(Number(trade.cumulative_shares || 0), 4)}</td>
                        <td class="trade-transactions-number">${formatMoney(Number(trade.invested || 0))}</td>
                        <td class="trade-transactions-number">${formatMoney(Number(trade.equity || 0))}</td>
                    `;
                    tbody.appendChild(row);
                }
                const paginationState = paginationApi.buildLocalStorePagination(totalPages, currentPage);
                nav.hidden = !paginationState.shouldRender;
                paginationApi.renderLocalStorePagination(nav, paginationState);
                if (animationState) {
                    paginationApi.animateLocalStorePaginationIndicator(nav, animationState);
                }
            }

            paginationApi.bindLocalStorePagination(nav, (targetPage, {animationState}) => {
                if (targetPage === currentPage) return;
                renderPage(targetPage, {animationState});
            });
            renderPage(1);
        };

        attachHover(priceCanvas, priceChart);
        attachHover(equityCanvas, equityChart);
        renderContributionTable();
        bootstrap.dcaTableAlignmentCleanup = buildTableAlignmentSync(
            document.querySelector(".dca-transactions-shell"),
            document.querySelector(".dca-transactions-shell .trade-transactions-wrap"),
            "--dca-transactions-scrollbar-width"
        );
        bindColorSchemeRefresh(() => {
            const nextTheme = readThemeTokens();
            priceChart.data.datasets[0].borderColor = nextTheme.accentPrimary;
            equityChart.data.datasets[0].borderColor = nextTheme.accentPositive;
            equityChart.data.datasets[1].borderColor = nextTheme.muted;
            priceChart.options.scales.y.ticks.color = nextTheme.muted;
            equityChart.options.scales.y.ticks.color = nextTheme.muted;
            priceChart.update();
            equityChart.update();
        });

        const markDcaChartReady = (canvas) => {
            if (!(canvas instanceof HTMLCanvasElement) || canvas.dataset.tradeChartReady === "1") return;
            canvas.dataset.tradeChartReady = "1";
            if (priceCanvas.dataset.tradeChartReady === "1" && equityCanvas.dataset.tradeChartReady === "1") {
                bootstrap.workspaceShare?.dispatchReady?.("dca");
            }
        };
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                markDcaChartReady(priceCanvas);
                markDcaChartReady(equityCanvas);
            });
        });
    };

    const share = () => bootstrap.workspaceShare || {};

    const buildDcaShareFilename = () => {
        const ticker = String(window.ANTIGRAVITY_APP?.dcaResult?.summary?.ticker || "").trim().toLowerCase() || "dca";
        return share().buildFilename?.("dca", ticker) || `dca-${ticker}.png`;
    };

    bootstrap.registerWorkspaceShareProvider?.("dca", {
        isReady: () => Boolean(window.ANTIGRAVITY_APP?.dcaResult) && share().areTradeChartsReady?.(),
        buildCard: () => share().buildTradeCard?.({
            shareView: "dca",
            title: document.querySelector(".workspace-mode-results-stack .workspace-summary-card .report-heading")?.textContent?.trim()
                || "DCA",
        }),
        buildFilename: buildDcaShareFilename,
    });

    bootstrap.initDcaWorkspace = initDcaWorkspace;
})();
