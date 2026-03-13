/* Code version: v1.2.2 */
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
	const buyMarkers = tradeBacktest.chart.buy_markers.map((flag, index) => (flag ? close[index] : null));
	const sellMarkers = tradeBacktest.chart.sell_markers.map((flag, index) => (flag ? close[index] : null));

	const axisLineColor = "rgba(160, 167, 178, 0.85)";
	const fixedYAxisWidth = 52;
	const commonOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: false } },
		scales: {
			x: {
				grid: { display: false },
				border: { color: axisLineColor, width: 1 },
				ticks: { color: theme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { weight: "700" } },
			},
			y: {
				grid: { display: false, drawTicks: false },
				border: { color: axisLineColor, width: 1 },
				afterFit: (scale) => {
					scale.width = fixedYAxisWidth;
				},
				ticks: { color: theme.muted, display: true, padding: 8 },
			},
		},
	};

	new Chart(priceCanvas, {
		type: "line",
		data: {
			labels,
			datasets: [
				{ label: "Close", data: close, borderColor: "#0055cc", borderWidth: 2, pointRadius: 0, tension: 0.18 },
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
	});

	new Chart(equityCanvas, {
		type: "line",
		data: {
			labels,
			datasets: [
				{ label: "Equity", data: equity, borderColor: "#111827", borderWidth: 2, pointRadius: 0, tension: 0.18 },
			],
		},
		options: commonOptions,
	});
})();
