/* Code version: v1.9.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

	const initTradeMessagesWorkspace = () => {
		const state = window.ANTIGRAVITY_APP;
		if (!state || state.currentView !== "trade-messages" || !window.Chart || !state.tradeBacktest) return;

		const priceCanvas = document.getElementById("tradePriceChart");
		const equityCanvas = document.getElementById("tradeEquityChart");
		if (!priceCanvas || !equityCanvas) return;
		const existingPriceChart = window.Chart.getChart?.(priceCanvas);
		const existingEquityChart = window.Chart.getChart?.(equityCanvas);
		if (existingPriceChart) existingPriceChart.destroy();
		if (existingEquityChart) existingEquityChart.destroy();
		priceCanvas.dataset.tradeChartMounted = "1";
		equityCanvas.dataset.tradeChartMounted = "1";

		const { tradeBacktest, theme } = state;
		const labels = tradeBacktest.chart.dates;
		const close = tradeBacktest.chart.close;
		const equity = tradeBacktest.chart.equity;
		const initialCapital = Number(tradeBacktest.summary?.initial_capital || 0);
		const allInReferenceColor = "#8e8e93";
		const monthAbbreviations = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const buyMarkers = tradeBacktest.chart.buy_markers.map((flag, index) => (flag ? close[index] : null));
		const sellMarkers = tradeBacktest.chart.sell_markers.map((flag, index) => (flag ? close[index] : null));
		const allInShares = close.length && close[0] > 0 ? Math.floor(initialCapital / close[0]) : 0;
		const allInCash = initialCapital - (allInShares * (close[0] || 0));
		const allInEquity = close.map((value) => Number((allInCash + (allInShares * value)).toFixed(4)));

		const axisLineColor = "rgba(160, 167, 178, 0.85)";
		const fixedYAxisWidth = 52;
		const tradeChartStack = priceCanvas.closest(".trade-chart-stack");
		if (!tradeChartStack) return;
		const existingHoverLine = tradeChartStack.querySelector(".trade-chart-hover-line");
		if (existingHoverLine) existingHoverLine.remove();
		const hoverLine = document.createElement("div");
		hoverLine.className = "trade-chart-hover-line";
		tradeChartStack.appendChild(hoverLine);

		const existingTooltip = tradeChartStack.querySelector(".chart-tooltip");
		if (existingTooltip) existingTooltip.remove();
		const tooltip = document.createElement("div");
		tooltip.className = "chart-tooltip";
		tooltip.innerHTML = `
			<p class="chart-tooltip-date"></p>
			<div class="chart-tooltip-list">
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot"></span>
					<span></span>
					<span class="chart-tooltip-label">Close</span>
					<span class="chart-tooltip-value" data-role="close"></span>
				</div>
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot"></span>
					<span></span>
					<span class="chart-tooltip-label">Net return</span>
					<span class="chart-tooltip-value" data-role="return"></span>
				</div>
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot"></span>
					<span></span>
					<span class="chart-tooltip-label">Equity</span>
					<span class="chart-tooltip-value" data-role="equity"></span>
				</div>
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot"></span>
					<span></span>
					<span class="chart-tooltip-label">If all in</span>
					<span class="chart-tooltip-value" data-role="all-in"></span>
				</div>
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot"></span>
					<span></span>
					<span class="chart-tooltip-label">vs all in</span>
					<span class="chart-tooltip-value" data-role="vs-all-in"></span>
				</div>
			</div>
		`;
		tradeChartStack.appendChild(tooltip);

		const formatMoney = (value) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
		const formatReturn = (value) => `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}%`;

		let activeIndex = null;
		let priceChart;
		let equityChart;

		const parseLabelDate = (value) => {
			const parsed = new Date(value);
			return Number.isNaN(parsed.getTime()) ? null : parsed;
		};

		const formatChartDate = (date) => `${date.getUTCDate()} ${monthAbbreviations[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

		const formatChartDateLines = (date) => [`${date.getUTCDate()} ${monthAbbreviations[date.getUTCMonth()]}`, `${date.getUTCFullYear()}`];

		const buildTickIndexSet = (count, plotWidth) => {
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
		};

		const referenceLinePlugin = {
			id: "tradeReferenceLine",
			beforeDatasetsDraw(chart) {
				if (chart.canvas !== equityCanvas) return;
				const { ctx, chartArea, scales } = chart;
				const yScale = scales?.y;
				if (!chartArea || !yScale || !Number.isFinite(initialCapital)) return;
				const y = yScale.getPixelForValue(initialCapital);
				if (!Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
				ctx.save();
				ctx.strokeStyle = axisLineColor;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(chartArea.left + 8, y);
				ctx.lineTo(chartArea.right - 8, y);
				ctx.stroke();
				ctx.restore();
			},
		};

		const xAxisLabelPlugin = {
			id: "tradeXAxisLabelPlugin",
			afterDraw(chart) {
				if (chart.canvas !== equityCanvas) return;
				const { ctx, chartArea, scales } = chart;
				const xScale = scales?.x;
				if (!chartArea || !xScale || !labels.length) return;
				const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
				const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
				const baselineY = chartArea.bottom + 16;
				const lineHeight = 12;
				ctx.save();
				ctx.fillStyle = theme.muted;
				ctx.font = '700 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
				ctx.textBaseline = "top";
				tickIndexes.forEach((index, tickIndex) => {
					const parsedDate = parseLabelDate(labels[index]);
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

		const commonOptions = {
			responsive: true,
			maintainAspectRatio: false,
			layout: { padding: { bottom: 34 } },
			interaction: { mode: "index", intersect: false },
			plugins: { legend: { display: false }, tooltip: { enabled: false } },
			scales: {
				x: {
					grid: { display: false },
					border: { display: false },
					ticks: { display: false },
				},
				y: {
					grid: { display: false, drawTicks: false },
					border: { display: false },
					afterFit: (scale) => {
						scale.width = fixedYAxisWidth;
					},
					ticks: { color: theme.muted, display: true, padding: 8 },
				},
			},
		};

		const updateHoverLineFrame = () => {
			if (!priceChart?.chartArea || !equityChart?.chartArea) return null;
			const priceCanvasRect = priceCanvas.getBoundingClientRect();
			const equityCanvasRect = equityCanvas.getBoundingClientRect();
			const stackRect = tradeChartStack.getBoundingClientRect();
			const top = priceCanvasRect.top - stackRect.top + priceChart.chartArea.top;
			const bottom = equityCanvasRect.top - stackRect.top + equityChart.chartArea.bottom;
			return { top, bottom };
		};

		const updateSharedTooltip = (index, sourceCanvas, sourceChart) => {
			if (index === null) {
				hoverLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				return;
			}
			const canvasRect = sourceCanvas.getBoundingClientRect();
			const stackRect = tradeChartStack.getBoundingClientRect();
			const sourcePoint = sourceChart?.getDatasetMeta(0)?.data?.[index];
			if (!sourcePoint) {
				hoverLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				return;
			}
			const relativeX = canvasRect.left - stackRect.left + sourcePoint.x;
			const relativeY = canvasRect.top - stackRect.top + sourcePoint.y;
			const hoverLineFrame = updateHoverLineFrame();
			if (hoverLineFrame) {
				hoverLine.style.top = `${hoverLineFrame.top}px`;
				hoverLine.style.height = `${Math.max(0, hoverLineFrame.bottom - hoverLineFrame.top)}px`;
			}
			hoverLine.style.left = `${relativeX}px`;
			hoverLine.classList.add("is-visible");
				const closeValue = Number(close[index] || 0);
			const equityValue = Number(equity[index] || 0);
			const allInValue = Number(allInEquity[index] || 0);
			const netReturn = initialCapital > 0 ? ((equityValue / initialCapital) - 1) * 100 : 0;
			const versusAllIn = equityValue - allInValue;
			const parsedLabelDate = parseLabelDate(labels[index]);
			tooltip.querySelector(".chart-tooltip-date").textContent = parsedLabelDate ? formatChartDate(parsedLabelDate) : labels[index];
			tooltip.querySelector('[data-role="close"]').textContent = formatMoney(closeValue);
			tooltip.querySelector('[data-role="return"]').textContent = formatReturn(netReturn);
			tooltip.querySelector('[data-role="equity"]').textContent = formatMoney(equityValue);
			tooltip.querySelector('[data-role="all-in"]').textContent = formatMoney(allInValue);
			const vsAllInValue = tooltip.querySelector('[data-role="vs-all-in"]');
			vsAllInValue.textContent = `${versusAllIn >= 0 ? "+" : "-"}${formatMoney(Math.abs(versusAllIn))}`;
			vsAllInValue.style.color = versusAllIn >= 0 ? theme.accent_positive : theme.accent_secondary;
			const dots = tooltip.querySelectorAll(".chart-tooltip-dot");
			if (dots[0]) dots[0].style.backgroundColor = theme.accent_primary;
			if (dots[1]) dots[1].style.backgroundColor = equityValue >= initialCapital ? theme.accent_positive : theme.accent_secondary;
			if (dots[2]) dots[2].style.backgroundColor = "#111827";
			if (dots[3]) dots[3].style.backgroundColor = allInReferenceColor;
			if (dots[4]) dots[4].style.backgroundColor = versusAllIn >= 0 ? theme.accent_positive : theme.accent_secondary;
			const tooltipWidth = tooltip.offsetWidth || 220;
			const rightSpace = stackRect.width - relativeX;
			const left = rightSpace >= tooltipWidth + 20 ? relativeX + 14 : Math.max(12, relativeX - tooltipWidth - 14);
			const tooltipHeight = tooltip.offsetHeight || 156;
			const padding = 12;
			let top = relativeY - (tooltipHeight / 2);
			if (top < padding) top = padding;
			if (top + tooltipHeight > stackRect.height - padding) top = stackRect.height - tooltipHeight - padding;
			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${Math.max(padding, top)}px`;
			tooltip.classList.add("is-visible");
		};

		const syncHoverState = (index, sourceCanvas, sourceChart) => {
			activeIndex = index;
			const setActive = (chart) => {
				if (!chart) return;
				chart.setActiveElements(index === null ? [] : [{ datasetIndex: 0, index }]);
				chart.update("none");
			};
			setActive(priceChart);
			setActive(equityChart);
			updateSharedTooltip(index, sourceCanvas, sourceChart);
		};

		const attachHover = (canvas, chart) => {
			canvas.addEventListener("mousemove", (event) => {
				const points = chart.getElementsAtEventForMode(event, "index", { intersect: false }, false);
				if (!points.length) {
					syncHoverState(null, canvas, chart);
					return;
				}
				syncHoverState(points[0].index, canvas, chart);
			});
			canvas.addEventListener("mouseleave", () => {
				syncHoverState(null, canvas, chart);
			});
		};

		priceChart = new Chart(priceCanvas, {
			type: "line",
			data: {
				labels,
				datasets: [
					{ label: "Close", data: close, borderColor: theme.accent_primary, borderWidth: 2.5, pointRadius: 0, tension: 0.18 },
					{ label: "Buy", data: buyMarkers, type: "scatter", showLine: false, pointRadius: 5, pointHoverRadius: 5, pointStyle: "triangle", rotation: 0, backgroundColor: "#16a34a" },
					{ label: "Sell", data: sellMarkers, type: "scatter", showLine: false, pointRadius: 5, pointHoverRadius: 5, pointStyle: "triangle", rotation: 180, backgroundColor: "#dc2626" },
				],
			},
			options: { ...commonOptions, scales: { ...commonOptions.scales, x: { ...commonOptions.scales.x, display: false } } },
			plugins: [],
		});

		equityChart = new Chart(equityCanvas, {
			type: "line",
			data: {
				labels,
				datasets: [
					{
						label: "Equity",
						data: equity,
						borderWidth: 2.5,
						pointRadius: 0,
						tension: 0.18,
						segment: {
							borderColor: (context) => {
								const target = Number(context.p1?.parsed?.y ?? context.p0?.parsed?.y ?? initialCapital);
								return target >= initialCapital ? theme.accent_positive : theme.accent_secondary;
							},
						},
					},
					{ label: "If all in", data: allInEquity, borderColor: allInReferenceColor, borderWidth: 2, pointRadius: 0, tension: 0.18 },
				],
			},
			options: commonOptions,
			plugins: [referenceLinePlugin, xAxisLabelPlugin],
		});

		attachHover(priceCanvas, priceChart);
		attachHover(equityCanvas, equityChart);
	};

	bootstrap.initTradeMessagesWorkspace = initTradeMessagesWorkspace;
	initTradeMessagesWorkspace();
})();
