/* Code version: v1.6.2 */
(() => {
	const state = window.ANTIGRAVITY_APP;
	if (!state || state.currentView !== "trade-messages" || !window.Chart || !state.tradeBacktest) return;

	const priceCanvas = document.getElementById("tradePriceChart");
	const equityCanvas = document.getElementById("tradeEquityChart");
	if (!priceCanvas || !equityCanvas) return;

	const { tradeBacktest, theme } = state;
	const labels = tradeBacktest.chart.dates;
	const close = tradeBacktest.chart.close;
	const equity = tradeBacktest.chart.equity;
	const initialCapital = Number(tradeBacktest.summary?.initial_capital || 0);
	const allInReferenceColor = "#8e8e93";
	const buyMarkers = tradeBacktest.chart.buy_markers.map((flag, index) => (flag ? close[index] : null));
	const sellMarkers = tradeBacktest.chart.sell_markers.map((flag, index) => (flag ? close[index] : null));
	const allInShares = close.length && close[0] > 0 ? Math.floor(initialCapital / close[0]) : 0;
	const allInCash = initialCapital - (allInShares * (close[0] || 0));
	const allInEquity = close.map((value) => Number((allInCash + (allInShares * value)).toFixed(4)));

	const axisLineColor = "rgba(160, 167, 178, 0.85)";
	const crosshairColor = "rgba(160, 167, 178, 0.85)";
	const fixedYAxisWidth = 52;
	const tradeChartStack = priceCanvas.closest(".trade-chart-stack");
	if (!tradeChartStack) return;

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

	const formatMoney = (value) => new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);
	const formatReturn = (value) => `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}%`;

	let activeIndex = null;
	let priceChart;
	let equityChart;

	const crosshairPlugin = {
		id: "tradeSharedCrosshair",
		afterDatasetsDraw(chart) {
			if (activeIndex === null) return;
			const meta = chart.getDatasetMeta(0);
			const point = meta?.data?.[activeIndex];
			if (!point) return;
			const { ctx, chartArea } = chart;
			ctx.save();
			ctx.beginPath();
			ctx.moveTo(point.x, chartArea.top);
			ctx.lineTo(point.x, chartArea.bottom);
			ctx.lineWidth = 1;
			ctx.strokeStyle = crosshairColor;
			ctx.stroke();
			ctx.restore();
		},
	};

	const commonOptions = {
		responsive: true,
		maintainAspectRatio: false,
		animation: false,
		layout: {
			padding: {
				bottom: 6,
			},
		},
		interaction: {
			mode: "index",
			intersect: false,
		},
		plugins: {
			legend: { display: false },
			tooltip: { enabled: false },
		},
		scales: {
			x: {
				grid: { display: false },
				border: { display: false },
				ticks: { color: theme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { weight: "700" } },
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

	const updateSharedTooltip = (index, sourceCanvas) => {
		if (index === null) {
			tooltip.classList.remove("is-visible");
			return;
		}
		const canvasRect = sourceCanvas.getBoundingClientRect();
		const stackRect = tradeChartStack.getBoundingClientRect();
		const relativeX = canvasRect.left - stackRect.left + priceChart.getDatasetMeta(0).data[index].x;
		const closeValue = Number(close[index] || 0);
		const equityValue = Number(equity[index] || 0);
		const allInValue = Number(allInEquity[index] || 0);
		const netReturn = initialCapital > 0 ? ((equityValue / initialCapital) - 1) * 100 : 0;
		const versusAllIn = equityValue - allInValue;
		tooltip.querySelector(".chart-tooltip-date").textContent = labels[index];
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
		const left = rightSpace >= tooltipWidth + 20
			? relativeX + 14
			: Math.max(12, relativeX - tooltipWidth - 14);
		const top = 12;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
		tooltip.classList.add("is-visible");
	};

	const syncHoverState = (index, sourceCanvas) => {
		activeIndex = index;
		const setActive = (chart) => {
			if (!chart) return;
			if (index === null) {
				chart.setActiveElements([]);
			} else {
				chart.setActiveElements([{ datasetIndex: 0, index }]);
			}
			chart.update("none");
		};
		setActive(priceChart);
		setActive(equityChart);
		updateSharedTooltip(index, sourceCanvas);
	};

	const attachHover = (canvas, chart) => {
		canvas.addEventListener("mousemove", (event) => {
			const points = chart.getElementsAtEventForMode(event, "index", { intersect: false }, false);
			if (!points.length) {
				syncHoverState(null, canvas);
				return;
			}
			syncHoverState(points[0].index, canvas);
		});
		canvas.addEventListener("mouseleave", () => {
			syncHoverState(null, canvas);
		});
	};

	priceChart = new Chart(priceCanvas, {
		type: "line",
		data: {
			labels,
			datasets: [
				{
					label: "Close",
					data: close,
					borderColor: theme.accent_primary,
					borderWidth: 2.5,
					pointRadius: 0,
					tension: 0.18,
				},
				{ label: "Buy", data: buyMarkers, type: "scatter", showLine: false, pointRadius: 5, pointHoverRadius: 5, pointStyle: "triangle", rotation: 0, backgroundColor: "#16a34a" },
				{ label: "Sell", data: sellMarkers, type: "scatter", showLine: false, pointRadius: 5, pointHoverRadius: 5, pointStyle: "triangle", rotation: 180, backgroundColor: "#dc2626" },
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				x: {
					...commonOptions.scales.x,
					display: false,
				},
			},
		},
		plugins: [crosshairPlugin],
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
				{
					label: "If all in",
					data: allInEquity,
					borderColor: allInReferenceColor,
					borderWidth: 2,
					pointRadius: 0,
					tension: 0.18,
				},
			],
		},
		options: commonOptions,
		plugins: [crosshairPlugin],
	});

	attachHover(priceCanvas, priceChart);
	attachHover(equityCanvas, equityChart);
})();
