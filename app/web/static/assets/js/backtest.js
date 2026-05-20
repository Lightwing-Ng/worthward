/* Code version: v0.3.4 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const backtestThemeState = bootstrap.backtestThemeState = bootstrap.backtestThemeState || {};

	const readThemeToken = (computed, tokenName) => computed.getPropertyValue(tokenName).trim();

	const readThemeTokens = () => {
		const computed = getComputedStyle(document.body);
		return {
			text: readThemeToken(computed, "--theme-text"),
			muted: readThemeToken(computed, "--theme-muted"),
			accentPrimary: readThemeToken(computed, "--theme-accent-primary"),
			accentSecondary: readThemeToken(computed, "--theme-accent-secondary"),
			accentPositive: readThemeToken(computed, "--theme-accent-positive"),
		};
	};

	const bindColorSchemeRefresh = (callback) => {
		if (backtestThemeState.mediaCleanup) {
			backtestThemeState.mediaCleanup();
			backtestThemeState.mediaCleanup = null;
		}
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => window.requestAnimationFrame(callback);
		if (typeof media.addEventListener === "function") {
			media.addEventListener("change", handler);
			backtestThemeState.mediaCleanup = () => media.removeEventListener("change", handler);
		} else if (typeof media.addListener === "function") {
			media.addListener(handler);
			backtestThemeState.mediaCleanup = () => media.removeListener(handler);
		}
	};

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

	const isWholeNumber = (value) => Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-6;

	const formatBacktestYAxisTick = (value, index, ticks) => {
		if (index === 0 || index === ticks.length - 1) return "";
		const numericValue = Number(value);
		if (!Number.isFinite(numericValue)) return String(value ?? "");
		const visibleTickValues = (Array.isArray(ticks) ? ticks : [])
			.slice(1, -1)
			.map((tick) => Number(tick?.value ?? tick))
			.filter((tickValue) => Number.isFinite(tickValue));
		const shouldAlignWithSingleDecimal = visibleTickValues.some((tickValue) => !isWholeNumber(tickValue));
		if (shouldAlignWithSingleDecimal) return numericValue.toFixed(1);
		return isWholeNumber(numericValue) ? String(Math.round(numericValue)) : String(numericValue);
	};

	const animateBacktestRefreshTransition = (priceChart, equityChart, transition, nextClose, nextEquity, nextAllIn, chartYPaddingPx) => {
		if (!priceChart || !equityChart || !transition) return;
		const nextRawLabels = Array.isArray(priceChart.data.rawLabels) ? priceChart.data.rawLabels : [];
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
		priceCanvas.dataset.tradeChartReady = "0";
		equityCanvas.dataset.tradeChartReady = "0";

		const { backtestResult } = state;
		const resolvedTheme = readThemeTokens();
		const labels = backtestResult.chart.dates;
		const rawDates = Array.isArray(backtestResult.chart.raw_dates) ? backtestResult.chart.raw_dates : [];
		const close = backtestResult.chart.close;
		const open = backtestResult.chart.open || [];
		const high = backtestResult.chart.high || [];
		const low = backtestResult.chart.low || [];
		const equity = backtestResult.chart.equity;
		
		const interval = backtestResult.interval || "1d";
		const rawTimestamps = rawDates.map((value) => {
			const parsed = Date.parse(value);
			return Number.isFinite(parsed) ? parsed : null;
		});
		const isSessionGap = (leftIndex, rightIndex) => {
			if (interval !== "1m") return false;
			const left = rawTimestamps[leftIndex];
			const right = rawTimestamps[rightIndex];
			if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
			return (right - left) > (90 * 60 * 1000);
		};
		const uniqueDays = new Set();
		rawDates.forEach(dateStr => {
			const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
			if (match) uniqueDays.add(match[1]);
		});
		const tradingDaysCount = uniqueDays.size;
		const isCandlestick = interval === "1m" && tradingDaysCount <= 1 && open.length > 0 && high.length > 0 && low.length > 0;
		
		const initialCapital = Number(backtestResult.summary?.initial_capital || 0);
		const allInReferenceColor = resolvedTheme.muted;
		const formatFullDateParts = bootstrap.dateDisplay?.formatFullDateParts;
		const formatFullDateLines = bootstrap.dateDisplay?.formatFullDateLines;
		const svgMarkerViewBox = { width: 20.3027, height: 20.5176 };
		const svgMarkerTip = {
			up: { x: 9.9707, y: 0.00976562 },
			down: { x: 9.9707, y: 20.5176 },
		};
		const svgMarkerPath = {
			up: new Path2D("M19.9414 19.1406C19.9414 18.6914 19.7461 18.3398 19.5117 17.8516L11.4844 1.26953C11.0254 0.332031 10.5859 0.00976562 9.9707 0.00976562C9.36523 0.00976562 8.92578 0.332031 8.45703 1.26953L0.439453 17.8516C0.195312 18.3496 0 18.7012 0 19.1504C0 20 0.634766 20.5176 1.64062 20.5176L18.3105 20.5078C19.3066 20.5078 19.9414 19.9902 19.9414 19.1406Z"),
			down: new Path2D("M19.9414 1.38672C19.9414 0.546875 19.3066 0.0195312 18.3105 0.0195312L1.64062 0.00976562C0.634766 0.00976562 0 0.537109 0 1.37695C0 1.83594 0.195312 2.1875 0.439453 2.68555L8.45703 19.2578C8.92578 20.2051 9.36523 20.5176 9.9707 20.5176C10.5859 20.5176 11.0254 20.2051 11.4844 19.2578L19.5117 2.68555C19.7461 2.19727 19.9414 1.8457 19.9414 1.38672Z"),
		};
		const formatTradeMarkerDateKey = (value, tradeInterval) => {
			const parsed = new Date(value);
			if (Number.isNaN(parsed.getTime())) return null;
			const year = parsed.getFullYear();
			const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
			const day = `${parsed.getDate()}`.padStart(2, "0");
			if (tradeInterval !== "1m") return `${year}/${month}/${day}`;
			const hours = `${parsed.getHours()}`.padStart(2, "0");
			const minutes = `${parsed.getMinutes()}`.padStart(2, "0");
			return `${year}/${month}/${day} ${hours}:${minutes}`;
		};
		const buildTradeMarkerPoints = (trades, dates, tradeInterval) => {
			if (!Array.isArray(trades) || !trades.length || !Array.isArray(dates) || !dates.length) {
				return { buy: [], sell: [] };
			}
			const indexByDate = new Map();
			dates.forEach((value, index) => {
				indexByDate.set(String(value), index);
				const formatted = formatTradeMarkerDateKey(value, tradeInterval);
				if (formatted) indexByDate.set(formatted, index);
			});
			return trades.reduce((accumulator, trade) => {
				if (trade?._virtual_close) return accumulator;
				const index = indexByDate.get(String(trade?.date || ""));
				const price = Number(trade?.price);
				if (!Number.isInteger(index) || !Number.isFinite(price)) return accumulator;
				const side = String(trade?.side || "");
				const marker = { index, price };
				if (side === "Buy") accumulator.buy.push(marker);
				if (side === "Sell") accumulator.sell.push(marker);
				return accumulator;
			}, { buy: [], sell: [] });
		};
		const tradeMarkerPoints = buildTradeMarkerPoints(backtestResult.trades, rawDates, interval);
		const firstOpen = open.length > 0 ? open[0] : (close.length > 0 ? close[0] : 0);
		const allInShares = firstOpen > 0 ? Math.floor(initialCapital / firstOpen) : 0;
		const allInCash = initialCapital - (allInShares * firstOpen);
		const allInEquity = close.map((value) => Number((allInCash + (allInShares * value)).toFixed(4)));

		const axisLineColor = resolvedTheme.muted;
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
			// Match ISO date with optional time part: yyyy-mm-dd HH:MM
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

		const formatChartDate = (dateParts) => {
			if (typeof formatFullDateParts === "function") {
				return formatFullDateParts(dateParts, { includeTime: true });
			}
			return `${dateParts.day}/${dateParts.monthIndex + 1}/${dateParts.year}`;
		};

		const formatChartDateLines = (dateParts) => (
			typeof formatFullDateLines === "function"
				? formatFullDateLines(dateParts, { allowWrap: true })
				: [`${dateParts.day}/${dateParts.monthIndex + 1}`, `${dateParts.year}`]
		);

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
				const viewportWidth = tradeChartStack?.clientWidth || chart.canvas?.clientWidth || window.innerWidth || document.documentElement.clientWidth || 0;
				const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
				const baselineY = chartArea.bottom;
				const lineHeight = 10;
				ctx.save();
				ctx.fillStyle = resolvedTheme.muted;
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
					
					const color = resolvedTheme.accentPrimary;
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

		const tradeMarkerPlugin = {
			id: "tradeMarkerPlugin",
			afterDatasetsDraw(chart) {
				if (chart.canvas !== priceCanvas) return;
				const yScale = chart.scales?.y;
				const priceMeta = chart.getDatasetMeta(0);
				if (!yScale || !priceMeta?.data?.length) return;

				const drawMarker = (marker, direction, color) => {
					const point = priceMeta.data[marker.index];
					const y = yScale.getPixelForValue(marker.price);
					if (!point || !Number.isFinite(point.x) || !Number.isFinite(y)) return;
					const sizePx = 8;
					const scale = sizePx / svgMarkerViewBox.width;
					const tip = svgMarkerTip[direction];
					const path = svgMarkerPath[direction];
					chart.ctx.save();
					chart.ctx.fillStyle = color;
					chart.ctx.translate(point.x, y);
					chart.ctx.scale(scale, scale);
					chart.ctx.translate(-tip.x, -tip.y);
					chart.ctx.fill(path);
					chart.ctx.restore();
				};

				tradeMarkerPoints.buy.forEach((marker) => drawMarker(marker, "up", resolvedTheme.accentPositive));
				tradeMarkerPoints.sell.forEach((marker) => drawMarker(marker, "down", resolvedTheme.accentSecondary));
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
						color: resolvedTheme.muted,
						display: true,
						padding: 8,
						callback(value, index, ticks) {
							return formatBacktestYAxisTick(value, index, ticks);
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

		const getDatasetPoint = (chart, index, datasetIndex = 0) => {
			const point = chart?.getDatasetMeta?.(datasetIndex)?.data?.[index];
			return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
		};

		const getRelativePointPosition = (canvas, stackRect, point) => {
			if (!canvas || !point) return null;
			const canvasRect = canvas.getBoundingClientRect();
			return {
				x: canvasRect.left - stackRect.left + point.x,
				y: canvasRect.top - stackRect.top + point.y,
			};
		};

		const TRADE_MARKER_SNAP_HORIZONTAL_BARS = 3;
		const TRADE_MARKER_SNAP_HORIZONTAL_PX = 20;
		const TRADE_MARKER_SNAP_VERTICAL_PX = 20;

		const resolveNearestHoverIndex = (chart, event) => {
			const chartArea = chart?.chartArea;
			if (!chartArea || !labels.length) return null;
			const canvasRect = chart.canvas.getBoundingClientRect();
			const relativeX = event.clientX - canvasRect.left;
			const relativeY = event.clientY - canvasRect.top;
			if (!Number.isFinite(relativeX)) return null;
			const points = chart.getDatasetMeta(0)?.data || [];

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

			if (!Number.isInteger(nearestIndex)) return null;
			if (chart.canvas !== priceCanvas || !Number.isFinite(relativeY)) return nearestIndex;
			if (relativeY < chartArea.top || relativeY >= chartArea.bottom) return nearestIndex;

			const yScale = chart.scales?.y;
			if (!yScale) return nearestIndex;

			const markerCandidates = [...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell];
			let snappedMarkerIndex = null;
			let snappedMarkerDistance = Number.POSITIVE_INFINITY;
			markerCandidates.forEach((marker) => {
				if (!marker || !Number.isInteger(marker.index) || !Number.isFinite(marker.price)) return;
				if (Math.abs(marker.index - nearestIndex) > TRADE_MARKER_SNAP_HORIZONTAL_BARS) return;
				const markerY = yScale.getPixelForValue(marker.price);
				if (!Number.isFinite(markerY)) return;
				if (Math.abs(markerY - relativeY) >= TRADE_MARKER_SNAP_VERTICAL_PX) return;
				const markerPoint = points[marker.index];
				if (!markerPoint || !Number.isFinite(markerPoint.x)) return;
				const markerDistance = Math.abs(markerPoint.x - relativeX);
				if (markerDistance >= TRADE_MARKER_SNAP_HORIZONTAL_PX) return;
				if (markerDistance < snappedMarkerDistance) {
					snappedMarkerDistance = markerDistance;
					snappedMarkerIndex = marker.index;
				}
			});
			if (Number.isInteger(snappedMarkerIndex)) return snappedMarkerIndex;
			return nearestIndex;
		};

		const updateSharedTooltip = (index, sourceCanvas, sourceChart) => {
			if (index === null) {
				hoverLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				return;
			}
			const stackRect = tradeChartStack.getBoundingClientRect();
			const sourcePoint = getDatasetPoint(sourceChart, index, 0);
			const pricePoint = getDatasetPoint(priceChart, index, 0);
			const equityPoint = getDatasetPoint(equityChart, index, 0);
			const canonicalLinePoint = pricePoint || equityPoint || sourcePoint;
			const canonicalLineCanvas = pricePoint ? priceCanvas : (equityPoint ? equityCanvas : sourceCanvas);
			if (!sourcePoint) {
				hoverLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				return;
			}
			const hoverLinePosition = getRelativePointPosition(canonicalLineCanvas, stackRect, canonicalLinePoint);
			const tooltipAnchorPosition = getRelativePointPosition(sourceCanvas, stackRect, sourcePoint);
			if (!hoverLinePosition || !tooltipAnchorPosition) {
				hoverLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				return;
			}
			const hoverLineFrame = updateHoverLineFrame();
			if (hoverLineFrame) {
				hoverLine.style.top = `${hoverLineFrame.top}px`;
				hoverLine.style.height = `${Math.max(0, hoverLineFrame.bottom - hoverLineFrame.top)}px`;
			}
			hoverLine.style.left = `${hoverLinePosition.x}px`;
			hoverLine.classList.add("is-visible");
			const relativeX = hoverLinePosition.x;
			const relativeY = tooltipAnchorPosition.y;
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
			vsAllInValue.style.color = versusAllIn >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary;
			const dots = tooltip.querySelectorAll(".chart-tooltip-dot");
			if (dots[0]) dots[0].style.backgroundColor = resolvedTheme.accentPrimary;
			if (dots[1]) dots[1].style.backgroundColor = equityValue >= initialCapital ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary;
			if (dots[2]) dots[2].style.backgroundColor = resolvedTheme.text;
			if (dots[3]) dots[3].style.backgroundColor = allInReferenceColor;
			if (dots[4]) dots[4].style.backgroundColor = versusAllIn >= 0 ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary;
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

		let activeBacktestRowElements = [];
		const activateBacktestRows = (rows, scrollContainer) => {
			activeBacktestRowElements.forEach((row) => {
				row.classList.remove("is-metric-hover-target", "is-metric-hover-active");
			});
			if (!rows || !rows.length) {
				activeBacktestRowElements = [];
				return;
			}
			rows.forEach((row) => {
				void row.offsetWidth;
				row.classList.add("is-metric-hover-target", "is-metric-hover-active");
			});
			activeBacktestRowElements = rows;

			const firstRow = rows[0];
			if (scrollContainer) {
				const rowOffset = firstRow.offsetTop - scrollContainer.offsetTop;
				const targetTop = rowOffset - (scrollContainer.clientHeight / 2) + (firstRow.clientHeight / 2);
				scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
			} else {
				firstRow.scrollIntoView({ block: "center", behavior: "smooth" });
			}
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

			if (index !== null) {
				const scrollContainer = document.querySelector("#tradeTransactionsTable")?.closest(".scrollable-data-table-scroll");
				const rows = Array.from(document.querySelectorAll(`#tradeTransactionsTable tbody tr[data-chart-index="${index}"]`));
				activateBacktestRows(rows, scrollContainer);
			} else {
				activateBacktestRows([], null);
			}
		};

		const attachHover = (canvas, chart) => {
			if (canvas._abortController) canvas._abortController.abort();
			const controller = new AbortController();
			canvas._abortController = controller;
			const { signal } = controller;

			canvas.addEventListener("mousemove", (event) => {
				if (!chart || !chart.ctx) return;
				const nearestIndex = resolveNearestHoverIndex(chart, event);
				if (nearestIndex === null) {
					syncHoverState(null, canvas, chart);
					return;
				}
				syncHoverState(nearestIndex, canvas, chart);
			}, { signal });

			canvas.addEventListener("mouseleave", () => {
				if (!chart || !chart.ctx) return;
				syncHoverState(null, canvas, chart);
			}, { signal });
		};

		const refreshTransition = consumeBacktestRefreshTransition();
		const priceSeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.close, rawDates, close)
			: close;
		const equitySeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.equity, rawDates, equity)
			: equity;
		const allInSeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.allIn, rawDates, allInEquity)
			: allInEquity;
		const priceYScale = buildPixelPaddedYScale(priceCanvas, [priceSeriesStart], chartYPaddingPx);
		const equityYScale = buildPixelPaddedYScale(equityCanvas, [equitySeriesStart, allInSeriesStart], chartYPaddingPx);
		const markBacktestChartReady = (canvas) => {
			if (!canvas || canvas.dataset.tradeChartReady === "1") return;
			canvas.dataset.tradeChartReady = "1";
			if (priceCanvas.dataset.tradeChartReady === "1" && equityCanvas.dataset.tradeChartReady === "1") {
				window.dispatchEvent(new CustomEvent("antigravity:backtest-charts-ready"));
			}
		};
		const resolveChartReadyAnimation = (canvas, animationConfig) => {
			if (animationConfig === false) {
				window.requestAnimationFrame(() => {
					window.requestAnimationFrame(() => {
						markBacktestChartReady(canvas);
					});
				});
				return false;
			}
			const normalizedAnimation = (animationConfig && typeof animationConfig === "object") ? animationConfig : {};
			const previousOnComplete = typeof normalizedAnimation.onComplete === "function"
				? normalizedAnimation.onComplete
				: null;
			return {
				...normalizedAnimation,
				onComplete: (context) => {
					previousOnComplete?.(context);
					markBacktestChartReady(canvas);
				},
			};
		};

		priceChart = new Chart(priceCanvas, {
			type: "line",
			data: {
				labels,
				rawLabels: rawDates,
				datasets: [
					{
						label: "Close",
						data: priceSeriesStart,
						borderColor: isCandlestick ? "transparent" : resolvedTheme.accentPrimary,
						borderWidth: isCandlestick ? 0 : 2.5,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => (
								isSessionGap(context.p0DataIndex, context.p1DataIndex)
									? "rgba(0, 0, 0, 0)"
									: resolvedTheme.accentPrimary
							),
						},
					},
				],
			},
			options: {
				...commonOptions,
				animation: resolveChartReadyAnimation(priceCanvas, refreshTransition ? false : undefined),
				scales: {
					...commonOptions.scales,
					x: { ...commonOptions.scales.x, display: false },
					y: { ...commonOptions.scales.y, ...priceYScale },
				},
			},
			plugins: [candlestickPlugin, tradeMarkerPlugin],
		});

		equityChart = new Chart(equityCanvas, {
			type: "line",
			data: {
				labels,
				rawLabels: rawDates,
				datasets: [
					{
						label: "Equity",
						data: equitySeriesStart,
						borderColor: resolvedTheme.accentPositive,
						borderWidth: 2.5,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => {
								if (isSessionGap(context.p0DataIndex, context.p1DataIndex)) {
									return "rgba(0, 0, 0, 0)";
								}
								const target = Number(context.p1?.parsed?.y ?? context.p0?.parsed?.y ?? initialCapital);
								return target >= initialCapital ? resolvedTheme.accentPositive : resolvedTheme.accentSecondary;
							},
						},
					},
					{
						label: "If all in",
						data: allInSeriesStart,
						borderColor: allInReferenceColor,
						borderWidth: 2,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => (
								isSessionGap(context.p0DataIndex, context.p1DataIndex)
									? "rgba(0, 0, 0, 0)"
									: allInReferenceColor
							),
						},
					},
				],
			},
			options: {
				...commonOptions,
				animation: resolveChartReadyAnimation(equityCanvas, refreshTransition ? false : undefined),
				scales: {
					...commonOptions.scales,
					x: { ...commonOptions.scales.x, display: false },
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

			const indexByDate = new Map();
			rawDates.forEach((value, index) => {
				indexByDate.set(String(value), index);
				const formatted = formatTradeMarkerDateKey(value, interval);
				if (formatted) indexByDate.set(formatted, index);
			});

			const trades = backtestResult.trades || [];
			const displayTrades = trades.filter((trade) => !trade._virtual_close);
			if (!displayTrades.length) {
				nav.hidden = true;
				return;
			}

			const PAGE_SIZE = Math.max(displayTrades.length, 1);
			const totalPages = 1;
			
			nav.style.display = "none";

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
				const end = Math.min(start + PAGE_SIZE, displayTrades.length);
				
				tbody.innerHTML = "";
				let displayIndex = 1;
				for (let i = start; i < end; i++) {
					const trade = displayTrades[i];
					// Skip virtual closing trades that are only used for win rate calculation
					if (trade._virtual_close) {
						continue;
					}
					const tr = document.createElement("tr");
					const chartIndex = indexByDate.has(String(trade.date || "")) ? indexByDate.get(String(trade.date || "")) : "";
					tr.dataset.chartIndex = chartIndex;
					tr.innerHTML = `
						<td class="trade-transactions-index">${displayIndex++}</td>
						<td class="trade-transactions-date">${trade.date}</td>
						<td class="trade-transactions-side">${trade.side}</td>
						<td class="trade-transactions-number">${formatNumber(trade.price)}</td>
						<td class="trade-transactions-number">${formatShares(trade.shares)}</td>
						<td class="trade-transactions-number">${formatNumber(trade.pnl)}</td>
						<td class="trade-transactions-number">${formatNumber(trade.cash)}</td>
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
		bindColorSchemeRefresh(() => {
			const nextTheme = readThemeTokens();
			const nextAllInReferenceColor = nextTheme.muted;
			priceChart.options.scales.y.ticks.color = nextTheme.muted;
			equityChart.options.scales.y.ticks.color = nextTheme.muted;
			priceChart.data.datasets[0].borderColor = isCandlestick ? "transparent" : nextTheme.accentPrimary;
			priceChart.data.datasets[0].segment.borderColor = (context) => (
				isSessionGap(context.p0DataIndex, context.p1DataIndex)
					? "rgba(0, 0, 0, 0)"
					: nextTheme.accentPrimary
			);
			equityChart.data.datasets[1].borderColor = nextAllInReferenceColor;
			equityChart.data.datasets[1].segment.borderColor = (context) => (
				isSessionGap(context.p0DataIndex, context.p1DataIndex)
					? "rgba(0, 0, 0, 0)"
					: nextAllInReferenceColor
			);
			priceChart.update();
			equityChart.update();
		});
		initTransactionsPagination();
		if (refreshTransition) {
			animateBacktestRefreshTransition(priceChart, equityChart, refreshTransition, close, equity, allInEquity, chartYPaddingPx);
		}
	};

	bootstrap.initBacktestWorkspace = initBacktestWorkspace;
	initBacktestWorkspace();
})();
