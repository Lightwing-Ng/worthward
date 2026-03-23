/* Code version: v1.14.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

	const consumeBacktestRefreshTransition = () => {
		const transition = bootstrap.backtestRefreshTransition;
		if (!transition?.rawLabels?.length) return null;
		delete bootstrap.backtestRefreshTransition;
		return transition;
	};

	const buildAlignedSeries = (sourceLabels, sourceValues, targetLabels, fallbackValues) => {
		if (!Array.isArray(targetLabels) || !targetLabels.length) return [];
		if (!Array.isArray(sourceLabels) || !sourceLabels.length || !Array.isArray(sourceValues) || !sourceValues.length) {
			return Array.isArray(fallbackValues) ? [...fallbackValues] : [];
		}
		const exactMatchMap = new Map();
		sourceLabels.forEach((label, index) => {
			exactMatchMap.set(String(label), Number(sourceValues[index] ?? 0));
		});
		return targetLabels.map((label, index) => {
			const exact = exactMatchMap.get(String(label));
			if (Number.isFinite(exact)) return exact;
			if (targetLabels.length === 1) {
				return Number(sourceValues[sourceValues.length - 1] ?? fallbackValues?.[index] ?? 0);
			}
			const ratio = index / Math.max(1, targetLabels.length - 1);
			const sourceIndex = Math.round(ratio * Math.max(0, sourceValues.length - 1));
			const candidate = Number(sourceValues[sourceIndex] ?? fallbackValues?.[index] ?? 0);
			return Number.isFinite(candidate) ? candidate : 0;
		});
	};

	const buildAllInSeries = (closeSeries, capital) => {
		const initialCapital = Number(capital || 0);
		if (!Array.isArray(closeSeries) || !closeSeries.length || !Number.isFinite(initialCapital)) return [];
		const openingPrice = Number(closeSeries[0] || 0);
		if (!(openingPrice > 0)) return closeSeries.map(() => initialCapital);
		const shares = Math.floor(initialCapital / openingPrice);
		const cash = initialCapital - (shares * openingPrice);
		return closeSeries.map((value) => Number((cash + (shares * Number(value || 0))).toFixed(4)));
	};

	const readPxToken = (element, tokenName, fallbackValue) => {
		if (!(element instanceof Element)) return fallbackValue;
		const rawValue = getComputedStyle(element).getPropertyValue(tokenName).trim();
		const parsed = Number.parseFloat(rawValue);
		return Number.isFinite(parsed) ? parsed : fallbackValue;
	};

	const collectFiniteValues = (datasets) => {
		if (!Array.isArray(datasets)) return [];
		return datasets.flatMap((dataset) => (Array.isArray(dataset) ? dataset : []))
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value));
	};

	const buildPixelPaddedYScale = (canvas, datasets, paddingPx) => {
		const values = collectFiniteValues(datasets);
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
		const usableHeight = Math.max(canvasHeight - (safePaddingPx * 2), 1);
		const dataRange = rawMax - rawMin;
		const dataPadding = dataRange * (safePaddingPx / usableHeight);
		return {
			min: rawMin - dataPadding,
			max: rawMax + dataPadding,
			rawMin,
			rawMax,
		};
	};

	const applyBacktestYAxisScale = (chart, canvas, datasets, paddingPx) => {
		if (!chart?.options?.scales?.y) return;
		const nextScale = buildPixelPaddedYScale(canvas, datasets, paddingPx);
		chart.options.scales.y.min = nextScale.min;
		chart.options.scales.y.max = nextScale.max;
	};

	const animateBacktestRefreshTransition = (priceChart, equityChart, transition, nextClose, nextEquity, chartYPaddingPx) => {
		if (!priceChart || !equityChart || !transition) return;
		const nextRawLabels = priceChart.data.rawLabels || [];
		const nextAllIn = buildAllInSeries(nextClose, transition.initialCapital);
		const fromClose = buildAlignedSeries(transition.rawLabels, transition.close, nextRawLabels, nextClose);
		const fromEquity = buildAlignedSeries(transition.rawLabels, transition.equity, nextRawLabels, nextEquity);
		const fromAllIn = buildAlignedSeries(
			transition.rawLabels,
			transition.allIn,
			nextRawLabels,
			nextAllIn,
		);

		priceChart.data.datasets[0].data = fromClose;
		equityChart.data.datasets[0].data = fromEquity;
		equityChart.data.datasets[1].data = fromAllIn;
		applyBacktestYAxisScale(priceChart, priceChart.canvas, [fromClose], chartYPaddingPx);
		applyBacktestYAxisScale(equityChart, equityChart.canvas, [fromEquity, fromAllIn], chartYPaddingPx);
		priceChart.update("none");
		equityChart.update("none");

		window.requestAnimationFrame(() => {
			const animationConfig = {
				duration: 540,
				easing: "easeOutCubic",
			};
			priceChart.options.animation = animationConfig;
			equityChart.options.animation = animationConfig;
			priceChart.data.datasets[0].data = nextClose;
			equityChart.data.datasets[0].data = nextEquity;
			equityChart.data.datasets[1].data = nextAllIn;
			applyBacktestYAxisScale(priceChart, priceChart.canvas, [nextClose], chartYPaddingPx);
			applyBacktestYAxisScale(equityChart, equityChart.canvas, [nextEquity, nextAllIn], chartYPaddingPx);
			priceChart.update();
			equityChart.update();
		});
	};

	const initBacktestWorkspace = () => {
		const state = window.ANTIGRAVITY_APP;
		if (!state || state.currentView !== "backtest" || !window.Chart || !state.backtestResult) return;

		const priceCanvas = document.getElementById("tradePriceChart");
		const equityCanvas = document.getElementById("tradeEquityChart");
		if (!priceCanvas || !equityCanvas) return;
		const existingPriceChart = window.Chart.getChart?.(priceCanvas);
		const existingEquityChart = window.Chart.getChart?.(equityCanvas);
		if (existingPriceChart) existingPriceChart.destroy();
		if (existingEquityChart) existingEquityChart.destroy();
		priceCanvas.dataset.tradeChartMounted = "1";
		equityCanvas.dataset.tradeChartMounted = "1";

		const { backtestResult, theme } = state;
		const labels = backtestResult.chart.dates;
		const rawDates = Array.isArray(backtestResult.chart.raw_dates) ? backtestResult.chart.raw_dates : [];
		const close = backtestResult.chart.close;
		const open = backtestResult.chart.open || [];
		const high = backtestResult.chart.high || [];
		const low = backtestResult.chart.low || [];
		const equity = backtestResult.chart.equity;
		
		const interval = backtestResult.interval || "1d";
		const uniqueDays = new Set();
		rawDates.forEach(dateStr => {
			const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
			if (match) uniqueDays.add(match[1]);
		});
		const tradingDaysCount = uniqueDays.size;
		const isCandlestick = interval === "1m" && tradingDaysCount <= 1 && open.length > 0 && high.length > 0 && low.length > 0;
		
		const initialCapital = Number(backtestResult.summary?.initial_capital || 0);
		const allInReferenceColor = "#8e8e93";
		const monthAbbreviations = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const buyMarkers = backtestResult.chart.buy_markers.map((flag, index) => (flag ? close[index] : null));
		const sellMarkers = backtestResult.chart.sell_markers.map((flag, index) => (flag ? close[index] : null));
		const allInShares = close.length && close[0] > 0 ? Math.floor(initialCapital / close[0]) : 0;
		const allInCash = initialCapital - (allInShares * (close[0] || 0));
		const allInEquity = close.map((value) => Number((allInCash + (allInShares * value)).toFixed(4)));

		const axisLineColor = "rgba(160, 167, 178, 0.85)";
		const fixedYAxisWidth = 52;
		const tradeChartStack = priceCanvas.closest(".trade-chart-stack");
		if (!tradeChartStack) return;
		const chartYPaddingPx = readPxToken(tradeChartStack, "--trade-chart-y-padding-px", 5);
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

		const parseRawDate = (value) => {
			if (typeof value !== "string") return null;
			// Match date part only (yyyy-mm-dd) from ISO strings or simple date strings
			const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
			if (!match) return null;
			return {
				year: Number(match[1]),
				monthIndex: Number(match[2]) - 1,
				day: Number(match[3]),
			};
		};

		const formatChartDate = (dateParts) => `${dateParts.day} ${monthAbbreviations[dateParts.monthIndex]} ${dateParts.year}`;

		const formatChartDateLines = (dateParts) => [`${dateParts.day} ${monthAbbreviations[dateParts.monthIndex]}`, `${dateParts.year}`];

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
				const baselineY = chartArea.bottom;
				const lineHeight = 10;
				ctx.save();
				ctx.fillStyle = theme.muted;
				ctx.font = '700 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
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

		const candlestickPlugin = {
			id: "tradeCandlestickPlugin",
			afterDatasetsDraw(chart) {
				if (!isCandlestick || chart.canvas !== priceCanvas) return;
				const { ctx, chartArea, data, scales } = chart;
				const meta = chart.getDatasetMeta(0);
				const xScale = scales.x;
				const yScale = scales.y;
				if (!meta || !meta.data.length) return;

				const columnWidth = (chartArea.right - chartArea.left) / labels.length;
				const candleWidth = Math.min(20, Math.max(1.5, columnWidth * 0.72));
				const wickWidth = 1;

				ctx.save();
				meta.data.forEach((point, i) => {
					const o = open[i];
					const h = high[i];
					const l = low[i];
					const c = close[i];
					if (!Number.isFinite(o) || !Number.isFinite(c)) return;

					const x = point.x;
					const openY = yScale.getPixelForValue(o);
					const highY = yScale.getPixelForValue(h);
					const lowY = yScale.getPixelForValue(l);
					const closeY = yScale.getPixelForValue(c);
					
					const color = "#0055cc";
					ctx.strokeStyle = color;
					ctx.fillStyle = color;

					// Wick
					ctx.lineWidth = wickWidth;
					ctx.beginPath();
					ctx.moveTo(x, highY);
					ctx.lineTo(x, lowY);
					ctx.stroke();

					// Body
					const bodyTop = Math.min(openY, closeY);
					const bodyBottom = Math.max(openY, closeY);
					const bodyHeight = Math.max(0.75, bodyBottom - bodyTop);
					ctx.fillRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
				});
				ctx.restore();
			},
		};

		const commonOptions = {
			responsive: true,
			maintainAspectRatio: false,
			layout: { padding: { bottom: 22 } },
			interaction: { mode: "index", intersect: false },
			plugins: { legend: { display: false }, tooltip: { enabled: false } },
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
						scale.width = fixedYAxisWidth;
					},
					ticks: {
						color: theme.muted,
						display: true,
						padding: 8,
						callback(value, index, ticks) {
							if (index === 0 || index === ticks.length - 1) return "";
							return typeof this.getLabelForValue === "function" ? this.getLabelForValue(value) : String(value);
						},
					},
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
			const parsedLabelDate = parseRawDate(rawDates[index]);
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
				if (!chart || !chart.ctx) return;
				chart.setActiveElements(index === null ? [] : [{ datasetIndex: 0, index }]);
				chart.update("none");
			};
			setActive(priceChart);
			setActive(equityChart);
			updateSharedTooltip(index, sourceCanvas, sourceChart);
		};

		const attachHover = (canvas, chart) => {
			if (canvas._abortController) canvas._abortController.abort();
			const controller = new AbortController();
			canvas._abortController = controller;
			const { signal } = controller;

			canvas.addEventListener("mousemove", (event) => {
				if (!chart || !chart.ctx) return;
				const points = chart.getElementsAtEventForMode(event, "index", { intersect: false }, false);
				if (!points.length) {
					syncHoverState(null, canvas, chart);
					return;
				}
				syncHoverState(points[0].index, canvas, chart);
			}, { signal });

			canvas.addEventListener("mouseleave", () => {
				if (!chart || !chart.ctx) return;
				syncHoverState(null, canvas, chart);
			}, { signal });
		};

		const refreshTransition = consumeBacktestRefreshTransition();
		const priceSeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.labels, refreshTransition.close, labels, close)
			: close;
		const equitySeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.labels, refreshTransition.equity, labels, equity)
			: equity;
		const priceYScale = buildPixelPaddedYScale(priceCanvas, [priceSeriesStart], chartYPaddingPx);
		const equityYScale = buildPixelPaddedYScale(equityCanvas, [equitySeriesStart, allInEquity], chartYPaddingPx);

		priceChart = new Chart(priceCanvas, {
			type: "line",
			data: {
				labels,
				datasets: [
					{
						label: "Close",
						data: priceSeriesStart,
						borderColor: isCandlestick ? "transparent" : theme.accent_primary,
						borderWidth: isCandlestick ? 0 : 2.5,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
					},
					{ label: "Buy", data: buyMarkers, type: "scatter", showLine: false, pointRadius: 5, pointHoverRadius: 5, pointStyle: "triangle", rotation: 0, backgroundColor: "#2fff9c" },
					{ label: "Sell", data: sellMarkers, type: "scatter", showLine: false, pointRadius: 5, pointHoverRadius: 5, pointStyle: "triangle", rotation: 180, backgroundColor: "#ff2f92" },
				],
			},
			options: {
				...commonOptions,
				animation: refreshTransition ? false : undefined,
				scales: {
					...commonOptions.scales,
					x: { ...commonOptions.scales.x, display: false },
					y: { ...commonOptions.scales.y, ...priceYScale },
				},
			},
			plugins: [candlestickPlugin],
		});

		equityChart = new Chart(equityCanvas, {
			type: "line",
			data: {
				labels,
				datasets: [
					{
						label: "Equity",
						data: equitySeriesStart,
						borderWidth: 2.5,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => {
								const target = Number(context.p1?.parsed?.y ?? context.p0?.parsed?.y ?? initialCapital);
								return target >= initialCapital ? theme.accent_positive : theme.accent_secondary;
							},
						},
					},
					{ label: "If all in", data: allInEquity, borderColor: allInReferenceColor, borderWidth: 2, pointRadius: 0, tension: 0, borderJoinStyle: "round", borderCapStyle: "round" },
				],
			},
			options: {
				...commonOptions,
				animation: refreshTransition ? false : undefined,
				scales: {
					...commonOptions.scales,
					y: { ...commonOptions.scales.y, ...equityYScale },
				},
			},
			plugins: [referenceLinePlugin, xAxisLabelPlugin],
		});

		const initTransactionsPagination = () => {
			const table = document.getElementById("tradeTransactionsTable");
			const nav = document.getElementById("tradeTransactionsPagination");
			const tbody = table?.querySelector("tbody");
			if (!table || !nav || !tbody) return;

			const trades = backtestResult.trades || [];
			if (!trades.length) {
				nav.hidden = true;
				return;
			}

			const PAGE_SIZE = 10;
			const totalPages = Math.ceil(trades.length / PAGE_SIZE);
			
			if (totalPages <= 1) {
				nav.style.display = "none";
			} else {
				nav.style.display = "grid";
			}

			let currentPage = 1;

			const renderButtons = () => {
				nav.innerHTML = "";
				if (totalPages <= 1) return;
				
				const prevBtn = document.createElement("button");
				prevBtn.type = "button";
				prevBtn.className = "local-store-page-button local-store-page-nav";
				prevBtn.disabled = currentPage === 1;
				prevBtn.innerHTML = '<span class="icon icon-page-prev"></span>';
				prevBtn.onclick = () => { if(currentPage > 1) goToPage(currentPage - 1); };
				nav.appendChild(prevBtn);

				let start = Math.max(1, currentPage - 2);
				let end = Math.min(totalPages, start + 4);
				if (end === totalPages) start = Math.max(1, end - 4);

				for (let i = start; i <= end; i++) {
					const btn = document.createElement("button");
					btn.type = "button";
					btn.className = `local-store-page-button${i === currentPage ? " is-active" : ""}`;
					btn.textContent = i;
					btn.onclick = () => goToPage(i);
					nav.appendChild(btn);
				}

				const nextBtn = document.createElement("button");
				nextBtn.type = "button";
				nextBtn.className = "local-store-page-button local-store-page-nav";
				nextBtn.disabled = currentPage === totalPages;
				nextBtn.innerHTML = '<span class="icon icon-page-next"></span>';
				nextBtn.onclick = () => { if(currentPage < totalPages) goToPage(currentPage + 1); };
				nav.appendChild(nextBtn);
			};

			const formatNumber = (num) => Number(num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			const formatShares = (num) => Math.round(Number(num || 0)).toLocaleString();

			const goToPage = (p) => {
				currentPage = p;
				const start = (p - 1) * PAGE_SIZE;
				const end = Math.min(start + PAGE_SIZE, trades.length);
				
				tbody.innerHTML = "";
				for (let i = start; i < end; i++) {
					const trade = trades[i];
					const tr = document.createElement("tr");
					tr.innerHTML = `
						<td class="trade-transactions-index">${i + 1}</td>
						<td class="trade-transactions-date">${trade.date}</td>
						<td class="trade-transactions-side">${trade.side}</td>
						<td class="trade-transactions-number">${formatNumber(trade.price)}</td>
						<td class="trade-transactions-number">${formatShares(trade.shares)}</td>
						<td class="trade-transactions-number">${formatNumber(trade.pnl)}</td>
						<td class="trade-transactions-number">${formatNumber(trade.equity)}</td>
					`;
					tbody.appendChild(tr);
				}
				renderButtons();
			};

			goToPage(1);
		};

		attachHover(priceCanvas, priceChart);
		attachHover(equityCanvas, equityChart);
		initTransactionsPagination();
		if (refreshTransition) {
			animateBacktestRefreshTransition(priceChart, equityChart, refreshTransition, close, equity, chartYPaddingPx);
		}
	};

	bootstrap.initBacktestWorkspace = initBacktestWorkspace;
	initBacktestWorkspace();
})();
