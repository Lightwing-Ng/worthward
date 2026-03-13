/* Code version: v1.0.0 */
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

	const commonOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: false } },
		scales: {
			x: { grid: { display: false }, ticks: { color: theme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
			y: { grid: { color: "rgba(148, 163, 184, 0.12)" }, ticks: { color: theme.muted } },
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
		options: commonOptions,
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
