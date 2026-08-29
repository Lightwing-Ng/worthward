/* Code version: v0.12.2 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const backtestThemeState = bootstrap.backtestThemeState = bootstrap.backtestThemeState || {};
	const chartAxis = window.ANTIGRAVITY_CHART_AXIS || {};
	const probabilityGridApi = window.ANTIGRAVITY_BACKTEST_PROBABILITY_GRID || {};

	const readThemeToken = (computed, tokenName) => (
		typeof chartAxis.readThemeToken === "function"
			? chartAxis.readThemeToken(computed, tokenName)
			: computed.getPropertyValue(tokenName).trim()
	);

	const readThemeTokens = () => (
		typeof chartAxis.readThemeTokens === "function"
			? chartAxis.readThemeTokens()
			: (() => {
				const computed = getComputedStyle(document.body);
				return {
					text: readThemeToken(computed, "--theme-text"),
					muted: readThemeToken(computed, "--theme-muted"),
					accentPrimary: readThemeToken(computed, "--theme-accent-primary"),
					accentSecondary: readThemeToken(computed, "--theme-accent-secondary"),
					accentPositive: readThemeToken(computed, "--theme-accent-positive"),
				};
			})()
	);

	const bindColorSchemeRefresh = (callback) => {
		if (backtestThemeState.mediaCleanup) {
			backtestThemeState.mediaCleanup();
			backtestThemeState.mediaCleanup = null;
		}
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		let disposed = false;
		let refreshFrame = null;
		const handler = () => {
			if (disposed || refreshFrame !== null) return;
			refreshFrame = window.requestAnimationFrame(() => {
				refreshFrame = null;
				if (!disposed) callback();
			});
		};
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
		const cleanup = () => {
			if (disposed) return;
			disposed = true;
			cleanups.forEach((removeListener) => removeListener());
			if (refreshFrame !== null) {
				window.cancelAnimationFrame(refreshFrame);
				refreshFrame = null;
			}
			if (backtestThemeState.mediaCleanup === cleanup) {
				backtestThemeState.mediaCleanup = null;
			}
		};
		backtestThemeState.mediaCleanup = cleanup;
		return cleanup;
	};

	const consumeBacktestRefreshTransition = () => {
		const transition = bootstrap.backtestRefreshTransition;
		if (!transition?.rawLabels?.length) return null;
		delete bootstrap.backtestRefreshTransition;
		return transition;
	};

	const initBacktestHistoryTabs = () => {
		const segmentedControl = document.getElementById("backtest_history_view_segmented");
		const viewSurface = document.getElementById("backtest_history_surface");
		if (!segmentedControl || !viewSurface || segmentedControl.dataset.bound === "1") return;
		const panels = Array.from(viewSurface.querySelectorAll("[data-backtest-history-view-panel]"));
		const syncPanels = () => {
			const active = segmentedControl.querySelector('input[name="backtest_history_view_tab"]:checked')?.value || "transactions";
			segmentedControl.dataset.active = active;
			viewSurface.dataset.activeView = active;
			window.ANTIGRAVITY_SEGMENTED_CONTROLS?.sync?.(segmentedControl, {activeValue: active});
			panels.forEach((panel) => {
				panel.hidden = panel.dataset.backtestHistoryViewPanel !== active;
			});
		};
		segmentedControl.dataset.bound = "1";
		segmentedControl.querySelectorAll('input[name="backtest_history_view_tab"]').forEach((input) => {
			input.addEventListener("change", syncPanels);
		});
		syncPanels();
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

	const buildAllInSeries = (openSeries, closeSeries, capital) => {
		if (typeof chartAxis.buildAllInEquitySeries === "function") {
			return chartAxis.buildAllInEquitySeries(openSeries, closeSeries, capital);
		}
		const initialCapital = Number(capital || 0);
		if (!Array.isArray(closeSeries) || !closeSeries.length || !Number.isFinite(initialCapital)) return [];
		const openingPrice = Number((Array.isArray(openSeries) && openSeries.length ? openSeries[0] : closeSeries[0]) || 0);
		if (!(openingPrice > 0)) return closeSeries.map(() => initialCapital);
		const shares = Math.floor(initialCapital / openingPrice);
		const cash = initialCapital - (shares * openingPrice);
		return closeSeries.map((value) => Number((cash + (shares * Number(value || 0))).toFixed(4)));
	};

	const readPxToken = (element, tokenName, fallbackValue) => {
		if (typeof chartAxis.readPxToken === "function") {
			return chartAxis.readPxToken(element, tokenName, fallbackValue);
		}
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

	const buildPixelPaddedYScale = (canvas, datasets, paddingPx, plotHeightPx = null) => {
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
		const paddingDescriptor = paddingPx && typeof paddingPx === "object"
			? paddingPx
			: {top: paddingPx, bottom: paddingPx};
		const safeTopPaddingPx = Math.max(0, Number(paddingDescriptor.top) || 0);
		const safeBottomPaddingPx = Math.max(0, Number(paddingDescriptor.bottom) || 0);
		const resolvedPlotHeight = Number(plotHeightPx) > 0
			? Number(plotHeightPx)
			: Math.max(canvasHeight - 22, 1);
		const usableHeight = Math.max(
			resolvedPlotHeight - safeTopPaddingPx - safeBottomPaddingPx,
			1,
		);
		const dataRange = rawMax - rawMin;
		const topDataPadding = dataRange * (safeTopPaddingPx / usableHeight);
		const bottomDataPadding = dataRange * (safeBottomPaddingPx / usableHeight);
		return {
			min: rawMin - bottomDataPadding,
			max: rawMax + topDataPadding,
			rawMin,
			rawMax,
		};
	};

	const applyBacktestYAxisScale = (chart, canvas, datasets, paddingPx) => {
		if (!chart?.options?.scales?.y) return;
		const plotHeightPx = chart?.chartArea
			? Math.max(1, chart.chartArea.bottom - chart.chartArea.top)
			: null;
		const nextScale = buildPixelPaddedYScale(canvas, datasets, paddingPx, plotHeightPx);
		chart.options.scales.y.min = nextScale.min;
		chart.options.scales.y.max = nextScale.max;
	};

	const formatStockPriceAxisValue = (value) => {
		if (typeof chartAxis.formatStockPriceAxisValue === "function") {
			return chartAxis.formatStockPriceAxisValue(value);
		}
		const numericValue = Number(value);
		if (!Number.isFinite(numericValue)) return "";
		const fractionDigits = Math.abs(numericValue) >= 100 ? 0 : 2;
		return numericValue.toLocaleString("en-US", {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		});
	};

	const formatBacktestYAxisTick = (value, index, ticks, fractionDigits, valueFormatter = null) => {
		if (index === 0 || index === ticks.length - 1) return "";
		const numericValue = Number(value);
		if (!Number.isFinite(numericValue)) return String(value ?? "");
		if (typeof valueFormatter === "function") return valueFormatter(numericValue);
		return numericValue.toLocaleString("en-US", {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		});
	};

	const animateBacktestRefreshTransition = (
		priceChart,
		equityChart,
		transition,
		nextClose,
		nextEquity,
		nextAllIn,
		getPriceYPadding,
		getEquityYPadding,
	) => {
		if (!priceChart || !equityChart || !transition) return null;
		const resolvePadding = (valueOrGetter) => (
			typeof valueOrGetter === "function" ? valueOrGetter() : valueOrGetter
		);
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
		applyBacktestYAxisScale(priceChart, priceChart.canvas, [fromClose], resolvePadding(getPriceYPadding));
		applyBacktestYAxisScale(equityChart, equityChart.canvas, [fromEquity, fromAllIn], resolvePadding(getEquityYPadding));
		priceChart.update("none");
		equityChart.update("none");

		const startSeries = [
			priceChart.data.datasets[0].data.slice(),
			equityChart.data.datasets[0].data.slice(),
			equityChart.data.datasets[1].data.slice(),
		];
		const targetSeries = [nextClose, nextEquity, nextAllIn];
		const applyProgress = (progress) => {
			const interpolate = (series, index) => series.map((targetValue, valueIndex) => {
				const startValue = Number(startSeries[index][valueIndex]);
				const endValue = Number(targetValue);
				if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return progress >= 1 ? targetValue : startSeries[index][valueIndex] ?? targetValue;
				return startValue + ((endValue - startValue) * progress);
			});
			priceChart.data.datasets[0].data = interpolate(targetSeries[0], 0);
			equityChart.data.datasets[0].data = interpolate(targetSeries[1], 1);
			equityChart.data.datasets[1].data = interpolate(targetSeries[2], 2);
			applyBacktestYAxisScale(
				priceChart,
				priceChart.canvas,
				[priceChart.data.datasets[0].data],
				resolvePadding(getPriceYPadding),
			);
			applyBacktestYAxisScale(
				equityChart,
				equityChart.canvas,
				[equityChart.data.datasets[0].data, equityChart.data.datasets[1].data],
				resolvePadding(getEquityYPadding),
			);
			priceChart.update("none");
			equityChart.update("none");
		};
		const scheduler = window.AntigravityMotion?.scheduler;
		if (scheduler?.animate) {
			return scheduler.animate({
				key: 'backtest-refresh-transition',
				duration: window.AntigravityMotion?.durations?.emphasized ?? 420,
				ease: window.AntigravityMotion?.easing?.emphasized,
				update: applyProgress,
				complete: () => applyProgress(1),
			});
		} else {
			applyProgress(1);
		}
		return null;
	};

	const initBacktestWorkspace = () => {
		initBacktestHistoryTabs();
		bootstrap.backtestHoverController?.destroy?.();
		bootstrap.backtestHoverController = null;
		const resultsStack = document.querySelector(
			".backtest-results-stack.investment-workspace-header",
		);
		const state = window.ANTIGRAVITY_APP;
		if (!state || state.currentView !== "backtest" || state.selectedStrategyId === "dca" || !window.Chart || !state.backtestResult) {
			resultsStack?.classList.remove("has-probability-field");
			return;
		}

		const priceCanvas = document.getElementById("tradePriceChart");
		const equityCanvas = document.getElementById("tradeEquityChart");
		if (!priceCanvas || !equityCanvas) {
			resultsStack?.classList.remove("has-probability-field");
			return;
		}
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
		const strategyPresentation = typeof probabilityGridApi.normalizePresentation === "function"
			? probabilityGridApi.normalizePresentation(
				backtestResult.strategy_presentation,
				{raw_dates: rawDates, length: close.length},
			)
			: null;
		resultsStack?.classList.toggle("has-probability-field", Boolean(strategyPresentation));
		
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
		const allInEquity = Array.isArray(backtestResult.chart?.all_in_equity) && backtestResult.chart.all_in_equity.length
			? backtestResult.chart.all_in_equity.map((value) => Number(value || 0))
			: buildAllInSeries(open, close, initialCapital);

		const fixedYAxisWidth = 72;
		const probabilityForecastLanePlugin = {
			id: "backtestProbabilityForecastLanePlugin",
			beforeLayout(chart) {
				if (!strategyPresentation || !chart?.options?.layout?.padding) return;
				const widthFraction = Number(strategyPresentation.width_fraction);
				if (!(widthFraction > 0)) return;
				const availableWidth = Math.max(0, Number(chart.width || 0) - fixedYAxisWidth);
				chart.options.layout.padding.right = availableWidth
					* (widthFraction / (1 + widthFraction));
			},
		};
		const tradeChartStack = priceCanvas.closest(".trade-chart-stack");
		if (!tradeChartStack) return;
		const chartYPaddingPx = readPxToken(tradeChartStack, "--trade-chart-y-padding-px", 5);
		let priceChartYPadding = chartYPaddingPx;
		const existingHoverLine = tradeChartStack.querySelector(".trade-chart-hover-line");
		if (existingHoverLine) existingHoverLine.remove();
		const hoverLine = document.createElement("div");
		hoverLine.className = "trade-chart-hover-line";
		tradeChartStack.appendChild(hoverLine);

		tradeChartStack.querySelectorAll("[data-backtest-chart-tooltip]").forEach((node) => node.remove());
		const tooltip = document.createElement("div");
		tooltip.className = "chart-tooltip";
		tooltip.dataset.backtestChartTooltip = "summary";
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
		const probabilityTooltip = strategyPresentation ? document.createElement("div") : null;
		if (probabilityTooltip) {
			probabilityTooltip.className = "chart-tooltip backtest-probability-tooltip";
			probabilityTooltip.dataset.backtestChartTooltip = "probability-grid";
			probabilityTooltip.dataset.renderer = strategyPresentation.renderer;
			probabilityTooltip.setAttribute("role", "img");
			probabilityTooltip.setAttribute("aria-label", "Bayesian future price probability field");
			probabilityTooltip.innerHTML = '<div class="backtest-probability-grid" data-backtest-probability-grid></div>';
			tradeChartStack.appendChild(probabilityTooltip);
		}

		const formatMoney = (value) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
		const formatReturn = (value) => `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}%`;

		let activeIndex = null;
		let activePriceOverlay = false;
		let activeSourceCanvas = null;
		let activeSourceChart = null;
		let pinState = {mode: "tracking", activeIndex: null};
		let priceChart;
		let equityChart;
		const documentController = new AbortController();
		const controllerAnimationFrames = new Set();
		const controllerTaskCleanups = [];
		let controllerDestroyed = false;
		let hoverFrameId = null;
		let pendingHoverUpdate = null;
		let layoutFrameId = null;
		let layoutObserver = null;
		let themeCleanup = null;
		const requestControllerAnimationFrame = (callback) => {
			if (controllerDestroyed) return null;
			let frameId = null;
			frameId = window.requestAnimationFrame((timestamp) => {
				controllerAnimationFrames.delete(frameId);
				if (!controllerDestroyed) callback(timestamp);
			});
			controllerAnimationFrames.add(frameId);
			return frameId;
		};
		const cancelControllerAnimationFrame = (frameId) => {
			if (frameId === null || frameId === undefined) return;
			window.cancelAnimationFrame(frameId);
			controllerAnimationFrames.delete(frameId);
		};

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
				ctx.font = '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
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

		const priceHoverOverlayPlugin = {
			id: "backtestPriceHoverOverlayPlugin",
			beforeDatasetsDraw(chart) {
				if (chart.canvas !== priceCanvas || !activePriceOverlay || !Number.isInteger(activeIndex)) {
					chart._activeBacktestPriceGuideBounds = null;
					return;
				}
				const point = chart.getDatasetMeta(0)?.data?.[activeIndex];
				const price = Number(close[activeIndex]);
				const {ctx, chartArea} = chart;
				if (!point || !chartArea || !Number.isFinite(point.y) || !Number.isFinite(price)) return;
				const mutedSoft = getComputedStyle(document.body).getPropertyValue("--theme-muted-soft").trim()
					|| resolvedTheme.muted;
				ctx.save();
				ctx.strokeStyle = mutedSoft;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(chartArea.left, point.y);
				ctx.lineTo(chartArea.right, point.y);
				ctx.stroke();
				ctx.restore();
				chart._activeBacktestPriceGuideBounds = {
					index: activeIndex,
					left: chartArea.left,
					price,
					right: chartArea.right,
					y: point.y,
				};
			},
			afterDatasetsDraw(chart) {
				const bounds = chart._activeBacktestPriceGuideBounds;
				if (!bounds || typeof chartAxis.drawYAxisValueBadge !== "function") return;
				const formattedPrice = new Intl.NumberFormat("en-US", {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				}).format(bounds.price);
				chartAxis.drawYAxisValueBadge(chart, {
					y: bounds.y,
					value: bounds.price,
					formattedValue: formattedPrice,
					formatTickLabel: formatStockPriceAxisValue,
					fillColor: resolvedTheme.accentPrimary,
					boundsProperty: "_activeBacktestPriceGuideBounds",
					boundsAliases: {formattedPrice, price: bounds.price},
				});
			},
		};

		const buildYAxisTicks = (fractionDigits, valueFormatter = null) => ({
			color: resolvedTheme.muted,
			display: true,
			padding: 8,
			callback(value, index, ticks) {
				return formatBacktestYAxisTick(value, index, ticks, fractionDigits, valueFormatter);
			},
		});

		const commonOptions = {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
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
					ticks: buildYAxisTicks(0),
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
			if (strategyPresentation) return nearestIndex;

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

		const hideProbabilityTooltip = () => {
			probabilityTooltip?.classList.remove("is-visible");
			if (priceChart) priceChart._activeBacktestProbabilityGridBounds = null;
		};

		const renderProbabilityTooltip = (index, stackRect, pricePoint) => {
			if (!probabilityTooltip || !priceChart?.chartArea || !priceChart?.scales?.y || !pricePoint) {
				hideProbabilityTooltip();
				return false;
			}
			const meanValue = strategyPresentation?.predictive_mean?.[index];
			const scaleValue = strategyPresentation?.predictive_scale?.[index];
			const mean = Number(meanValue);
			const scale = Number(scaleValue);
			const anchorPrice = Number(close[index]);
			if (meanValue === null || meanValue === undefined
				|| scaleValue === null || scaleValue === undefined
				|| !Number.isFinite(mean) || !Number.isFinite(scale) || !(scale > 0) || !(anchorPrice > 0)) {
				hideProbabilityTooltip();
				return false;
			}
			const geometry = probabilityGridApi.computeGridGeometry?.({
				chartArea: priceChart.chartArea,
				anchorX: pricePoint.x,
				anchorY: pricePoint.y,
				rowsAbove: strategyPresentation.rows_above,
				rowsBelow: strategyPresentation.rows_below,
				widthFraction: strategyPresentation.width_fraction,
				maxCellPx: 10,
			});
			if (!geometry) {
				hideProbabilityTooltip();
				return false;
			}
			const priceDatasetPoints = priceChart.getDatasetMeta(0)?.data || [];
			const stepPixels = probabilityGridApi.resolveDatasetStepPixels?.(priceDatasetPoints, index);
			if (!(stepPixels > 0)) {
				hideProbabilityTooltip();
				return false;
			}
			const cells = probabilityGridApi.buildProbabilityCells?.({
				geometry,
				anchorPrice,
				mean,
				scale,
				stepPixels,
				valueForPixel: (pixel) => priceChart.scales.y.getValueForPixel(pixel),
			}) || [];
			if (!cells.length) {
				hideProbabilityTooltip();
				return false;
			}

			const grid = probabilityTooltip.querySelector("[data-backtest-probability-grid]");
			if (!(grid instanceof HTMLElement)) {
				hideProbabilityTooltip();
				return false;
			}
			const canReuseCells = grid.childElementCount === cells.length
				&& Number(grid.dataset.columnCount) === geometry.columnCount
				&& Number(grid.dataset.rowCount) === geometry.rowCount;
			let cellNodes = canReuseCells ? Array.from(grid.children) : [];
			if (!canReuseCells) {
				const fragment = document.createDocumentFragment();
				cellNodes = cells.map(() => {
					const node = document.createElement("span");
					fragment.appendChild(node);
					return node;
				});
				grid.replaceChildren(fragment);
			}
			cells.forEach((cell, cellIndex) => {
				const node = cellNodes[cellIndex];
				node.className = `backtest-probability-cell is-${cell.sign}`;
				node.dataset.column = String(cell.column);
				node.dataset.horizon = String(cell.horizon);
				node.dataset.probability = String(cell.probability);
				node.dataset.row = String(cell.row);
				node.style.gridColumn = String(cell.column + 1);
				node.style.gridRow = String(cell.row + 1);
				node.style.opacity = String(cell.opacity);
				node.title = `${(cell.probability * 100).toFixed(2)}%`;
			});
			grid.dataset.columnCount = String(geometry.columnCount);
			grid.dataset.rowCount = String(geometry.rowCount);
			grid.style.gridTemplateColumns = `repeat(${geometry.columnCount}, ${geometry.cellSize}px)`;
			grid.style.gridTemplateRows = `repeat(${geometry.rowCount}, ${geometry.cellSize}px)`;
			grid.style.gap = `${geometry.gap}px`;
			grid.style.padding = `${geometry.padding}px`;

			const canvasRect = priceCanvas.getBoundingClientRect();
			const canvasOffsetX = canvasRect.left - stackRect.left;
			const canvasOffsetY = canvasRect.top - stackRect.top;
			probabilityTooltip.style.left = `${canvasOffsetX + geometry.left}px`;
			probabilityTooltip.style.top = `${canvasOffsetY + geometry.top}px`;
			probabilityTooltip.style.width = `${geometry.width}px`;
			probabilityTooltip.style.height = `${geometry.height}px`;
			probabilityTooltip.dataset.direction = geometry.direction;
			probabilityTooltip.dataset.pinned = pinState.mode === "pinned" ? "true" : "false";
			const upProbability = probabilityGridApi.normalCdf?.(mean / scale) ?? 0.5;
			probabilityTooltip.setAttribute(
				"aria-label",
				`${labels[index] || "Selected date"}, ${formatMoney(anchorPrice)}, ${(upProbability * 100).toFixed(1)}% probability above the selected price on the next bar`,
			);
			probabilityTooltip.classList.add("is-visible");
			priceChart._activeBacktestProbabilityGridBounds = {
				...geometry,
				canvasOffsetX,
				canvasOffsetY,
				index,
				intersectionX: pricePoint.x,
				intersectionY: pricePoint.y,
				maxProbability: Math.max(...cells.map((cell) => cell.probability)),
				stepPixels,
			};
			return true;
		};

		const updateSharedTooltip = (index, sourceCanvas, sourceChart) => {
			if (index === null) {
				hoverLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
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
				hideProbabilityTooltip();
				return false;
			}
			const hoverLinePosition = getRelativePointPosition(canonicalLineCanvas, stackRect, canonicalLinePoint);
			const tooltipAnchorPosition = getRelativePointPosition(sourceCanvas, stackRect, sourcePoint);
			if (!hoverLinePosition || !tooltipAnchorPosition) {
				hoverLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			const hoverLineFrame = updateHoverLineFrame();
			if (hoverLineFrame) {
				hoverLine.style.top = `${hoverLineFrame.top}px`;
				hoverLine.style.height = `${Math.max(0, hoverLineFrame.bottom - hoverLineFrame.top)}px`;
			}
			hoverLine.style.setProperty("--trade-chart-hover-line-x", `${hoverLinePosition.x}px`);
			hoverLine.classList.add("is-visible");
			if (activePriceOverlay && pricePoint && renderProbabilityTooltip(index, stackRect, pricePoint)) {
				tooltip.classList.remove("is-visible");
				return true;
			}
			hideProbabilityTooltip();
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
			return false;
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
			activeSourceCanvas = index === null ? null : sourceCanvas;
			activeSourceChart = index === null ? null : sourceChart;
			activePriceOverlay = Boolean(strategyPresentation && index !== null && sourceCanvas === priceCanvas);
			const setActive = (chart) => {
				if (!chart || !chart.ctx) return;
				chart.setActiveElements(index === null ? [] : [{ datasetIndex: 0, index }]);
				chart.update("none");
			};
			setActive(priceChart);
			setActive(equityChart);
			const probabilityRendered = updateSharedTooltip(index, sourceCanvas, sourceChart);

			if (index !== null) {
				const scrollContainer = document.querySelector("#tradeTransactionsTable")?.closest(".scrollable-data-table-scroll");
				const rows = Array.from(document.querySelectorAll(`#tradeTransactionsTable tbody tr[data-chart-index="${index}"]`));
				activateBacktestRows(rows, scrollContainer);
			} else {
				activateBacktestRows([], null);
			}
			return probabilityRendered;
		};

		const cancelScheduledHoverSync = () => {
			pendingHoverUpdate = null;
			if (hoverFrameId !== null) {
				cancelControllerAnimationFrame(hoverFrameId);
				hoverFrameId = null;
			}
		};

		const scheduleHoverSync = (index, sourceCanvas, sourceChart) => {
			pendingHoverUpdate = {index, sourceCanvas, sourceChart};
			if (hoverFrameId !== null) return;
			hoverFrameId = requestControllerAnimationFrame(() => {
				hoverFrameId = null;
				const pending = pendingHoverUpdate;
				pendingHoverUpdate = null;
				if (!pending || pinState.mode === "pinned" || !pending.sourceChart?.ctx) return;
				pinState = probabilityGridApi.reducePinState?.(
					pinState,
					{type: "track", index: pending.index},
				) || {mode: "tracking", activeIndex: pending.index};
				syncHoverState(pending.index, pending.sourceCanvas, pending.sourceChart);
			});
		};

		const attachHover = (canvas, chart) => {
			if (canvas._abortController) canvas._abortController.abort();
			const controller = new AbortController();
			canvas._abortController = controller;
			const { signal } = controller;

			canvas.addEventListener("mousemove", (event) => {
				if (!chart || !chart.ctx) return;
				if (pinState.mode === "pinned") return;
				const nearestIndex = resolveNearestHoverIndex(chart, event);
				scheduleHoverSync(nearestIndex, canvas, chart);
			}, { signal });

			canvas.addEventListener("mouseleave", () => {
				if (!chart || !chart.ctx) return;
				if (pinState.mode === "pinned") return;
				scheduleHoverSync(null, canvas, chart);
			}, { signal });

			if (canvas === priceCanvas && strategyPresentation) {
				canvas.addEventListener("click", (event) => {
					if (!chart || !chart.ctx) return;
					cancelScheduledHoverSync();
					const nearestIndex = resolveNearestHoverIndex(chart, event);
					const point = Number.isInteger(nearestIndex)
						? chart.getDatasetMeta(0)?.data?.[nearestIndex]
						: null;
					const canvasRect = canvas.getBoundingClientRect();
					const pointerY = event.clientY - canvasRect.top;
					const isCurveClick = Number.isInteger(nearestIndex)
						&& probabilityGridApi.isPointNearCurve?.(pointerY, point?.y, 14);
					const probabilityRendered = isCurveClick
						? renderProbabilityTooltip(
							nearestIndex,
							tradeChartStack.getBoundingClientRect(),
							point,
						)
						: false;
					if (probabilityRendered) {
						pinState = probabilityGridApi.reducePinState?.(
							pinState,
							{type: "pin", index: nearestIndex},
						) || {mode: "pinned", activeIndex: nearestIndex};
						syncHoverState(nearestIndex, canvas, chart);
						return;
					}
					if (pinState.mode === "pinned") {
						pinState = probabilityGridApi.reducePinState?.(pinState, {type: "clear"})
							|| {mode: "tracking", activeIndex: null};
						syncHoverState(null, canvas, chart);
					} else if (isCurveClick) {
						pinState = probabilityGridApi.reducePinState?.(
							pinState,
							{type: "track", index: nearestIndex},
						) || {mode: "tracking", activeIndex: nearestIndex};
						syncHoverState(nearestIndex, canvas, chart);
					}
				}, { signal });
			}
		};

		const refreshTransition = consumeBacktestRefreshTransition();
		const seriesLineWidth = readPxToken(tradeChartStack, "--trade-chart-series-line-width", 2.0);
		const priceSeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.close, rawDates, close)
			: close;
		const equitySeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.equity, rawDates, equity)
			: equity;
		const allInSeriesStart = refreshTransition
			? buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.allIn, rawDates, allInEquity)
			: allInEquity;
		const priceYScale = buildPixelPaddedYScale(priceCanvas, [priceSeriesStart], priceChartYPadding);
		const equityYScale = buildPixelPaddedYScale(equityCanvas, [equitySeriesStart, allInSeriesStart], chartYPaddingPx);
		const markBacktestChartReady = (canvas) => {
			if (!canvas || canvas.dataset.tradeChartReady === "1") return;
			canvas.dataset.tradeChartReady = "1";
			if (priceCanvas.dataset.tradeChartReady === "1" && equityCanvas.dataset.tradeChartReady === "1") {
				bootstrap.workspaceShare?.dispatchReady?.("backtest");
			}
		};
		const resolveChartReadyAnimation = (canvas) => {
			const readyScheduler = window.AntigravityMotion?.scheduler;
			if (readyScheduler?.frame) {
				let readyFrameCount = 0;
				const cleanupReadyFrame = readyScheduler.frame(`backtest-chart-ready-${canvas.id}`, () => {
					readyFrameCount += 1;
					if (readyFrameCount < 2) return true;
					markBacktestChartReady(canvas);
					return false;
				});
				if (typeof cleanupReadyFrame === "function") controllerTaskCleanups.push(cleanupReadyFrame);
			} else {
				requestControllerAnimationFrame(() => {
					requestControllerAnimationFrame(() => markBacktestChartReady(canvas));
				});
			}
			return false;
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
						borderWidth: isCandlestick ? 0 : seriesLineWidth,
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
				animation: resolveChartReadyAnimation(priceCanvas),
				scales: {
					...commonOptions.scales,
					x: { ...commonOptions.scales.x, display: false },
					y: {
						...commonOptions.scales.y,
						...priceYScale,
						ticks: buildYAxisTicks(2, formatStockPriceAxisValue),
					},
				},
			},
			plugins: [
				candlestickPlugin,
				tradeMarkerPlugin,
				priceHoverOverlayPlugin,
				...(strategyPresentation ? [probabilityForecastLanePlugin] : []),
			],
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
						borderWidth: 2.0,
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
						borderWidth: 1.0,
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
				animation: resolveChartReadyAnimation(equityCanvas),
				scales: {
					...commonOptions.scales,
					x: { ...commonOptions.scales.x, display: false },
					y: { ...commonOptions.scales.y, ...equityYScale },
				},
			},
			plugins: [
				xAxisLabelPlugin,
				...(strategyPresentation ? [probabilityForecastLanePlugin] : []),
			],
		});

		const initTransactionsPagination = () => {
			const table = document.getElementById("tradeTransactionsTable");
			const nav = document.getElementById("tradeTransactionsPagination");
			const tableShell = document.getElementById("backtest_history_table_wrap");
			const tbody = table?.querySelector("tbody");
			const paginationApi = window.ANTIGRAVITY_LOCAL_STORE_PAGINATION;
			if (!table || !nav || !tbody) return;
			if (!paginationApi) {
				window.addEventListener("antigravity:local-store-pagination-ready", initTransactionsPagination, {once: true});
				return;
			}

			const indexByDate = new Map();
			rawDates.forEach((value, index) => {
				indexByDate.set(String(value), index);
				const formatted = formatTradeMarkerDateKey(value, interval);
				if (formatted) indexByDate.set(formatted, index);
			});

			const trades = backtestResult.trades || [];
			const showTicker = Boolean(backtestResult.multi_asset);
			const displayTrades = trades.filter((trade) => !trade._virtual_close);
			if (!displayTrades.length) {
				nav.hidden = true;
				tableShell?.classList.remove("has-floating-pagination");
				return;
			}

			const PAGE_SIZE = paginationApi.LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE;
			const totalPages = Math.max(1, Math.ceil(displayTrades.length / PAGE_SIZE));
			let currentPage = 1;
			const syncTablePageUrl = (page) => {
				const nextPage = Math.max(1, Number(page) || 1);
				bootstrap.workspaceTablePage = nextPage;
				const nextUrl = new URL(window.location.href);
				if (nextPage > 1) nextUrl.searchParams.set("page", String(nextPage));
				else nextUrl.searchParams.delete("page");
				window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}`);
			};

			const formatNumber = (num) => Number(num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			const formatShares = (num) => Math.round(Number(num || 0)).toLocaleString();
			const numericTradeValue = (trade, key, fallback = 0) => {
				const value = Number(trade?.[key]);
				return Number.isFinite(value) ? value : fallback;
			};
			const escapeHtml = (value) => String(value)
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")
				.replaceAll('"', "&quot;")
				.replaceAll("'", "&#39;");
			const renderNumericCell = (value) => {
				const formatted = formatNumber(value);
				const renderer = window.ANTIGRAVITY_NUMERIC_DISPLAY?.renderNumericDisplayContent;
				return typeof renderer === "function" ? renderer(formatted) : escapeHtml(formatted);
			};
			const formatTradeDate = (value) => {
				const rawValue = String(value || "").trim();
				const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(rawValue);
				if (!match) return rawValue;
				const dateParts = {
					year: Number(match[1]),
					monthIndex: Number(match[2]) - 1,
					day: Number(match[3]),
				};
				const formatShortDateParts = bootstrap.dateDisplay?.formatShortDateParts;
				const dateText = typeof formatShortDateParts === "function"
					? formatShortDateParts(dateParts)
					: `${dateParts.year}/${String(dateParts.monthIndex + 1).padStart(2, "0")}/${String(dateParts.day).padStart(2, "0")}`;
				if (!match[4] || !match[5]) return dateText;
				const timeText = `${String(match[4]).padStart(2, "0")}:${match[5]}${match[6] ? `:${match[6]}` : ""}`;
				return `${dateText} ${timeText}`;
			};

			const goToPage = (p, {animationState = null} = {}) => {
				currentPage = Math.min(totalPages, Math.max(1, Number(p) || 1));
				const start = (currentPage - 1) * PAGE_SIZE;
				const end = Math.min(start + PAGE_SIZE, displayTrades.length);
				
				tbody.innerHTML = "";
				let displayIndex = start + 1;
				for (let i = start; i < end; i++) {
					const trade = displayTrades[i];
					const tr = document.createElement("tr");
					const chartIndex = indexByDate.has(String(trade.date || "")) ? indexByDate.get(String(trade.date || "")) : "";
					const equity = numericTradeValue(trade, "equity");
					const cash = numericTradeValue(trade, "cash");
					const marketValue = numericTradeValue(trade, "market_value", equity - cash);
					const quantity = numericTradeValue(trade, "quantity", numericTradeValue(trade, "shares"));
					const realizedPnl = numericTradeValue(trade, "realized_pnl", numericTradeValue(trade, "pnl"));
					const unrealizedPnl = numericTradeValue(trade, "unrealized_pnl");
					tr.dataset.chartIndex = chartIndex;
					tr.innerHTML = `
						<td class="trade-transactions-index">${displayIndex++}</td>
						<td class="trade-transactions-date">${escapeHtml(formatTradeDate(trade.date))}</td>
						${showTicker ? `<td class="trade-transactions-ticker">${trade.ticker || ""}</td>` : ""}
						<td class="trade-transactions-side">${trade.side}</td>
						<td class="trade-transactions-number price">${renderNumericCell(trade.price)}</td>
						<td class="trade-transactions-number quantity">${formatShares(quantity)}</td>
						<td class="trade-transactions-number realized-pnl">${renderNumericCell(realizedPnl)}</td>
						<td class="trade-transactions-number unrealized-pnl">${renderNumericCell(unrealizedPnl)}</td>
						<td class="trade-transactions-number cash">${renderNumericCell(cash)}</td>
						<td class="trade-transactions-number market-value">${renderNumericCell(marketValue)}</td>
						<td class="trade-transactions-number equity">${renderNumericCell(equity)}</td>
					`;
					tbody.appendChild(tr);
				}
				const paginationState = paginationApi.buildLocalStorePagination(totalPages, currentPage);
				nav.hidden = !paginationState.shouldRender;
				tableShell?.classList.toggle("has-floating-pagination", paginationState.shouldRender);
				paginationApi.renderLocalStorePagination(nav, paginationState);
				if (animationState) {
					paginationApi.animateLocalStorePaginationIndicator(nav, animationState);
				}
			};

			paginationApi.bindLocalStorePagination(nav, (targetPage, {animationState}) => {
				if (targetPage === currentPage) return;
				goToPage(targetPage, {animationState});
				syncTablePageUrl(currentPage);
			});
			const requestedPage = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href)?.page || 1;
			goToPage(requestedPage);
			syncTablePageUrl(currentPage);
		};

		attachHover(priceCanvas, priceChart);
		attachHover(equityCanvas, equityChart);
		const resolvePriceChartYPadding = () => {
			if (!strategyPresentation || !priceChart?.chartArea) return chartYPaddingPx;
			const chartArea = priceChart.chartArea;
			const gridGeometry = probabilityGridApi.computeGridGeometry?.({
				chartArea,
				anchorX: chartArea.left,
				anchorY: (chartArea.top + chartArea.bottom) / 2,
				rowsAbove: strategyPresentation.rows_above,
				rowsBelow: strategyPresentation.rows_below,
				widthFraction: strategyPresentation.width_fraction,
				maxCellPx: 10,
			});
			const gridHalfHeight = Number(gridGeometry?.height) / 2;
			if (!(gridHalfHeight > 0)) return chartYPaddingPx;

			const stackRect = tradeChartStack.getBoundingClientRect();
			const canvasRect = priceCanvas.getBoundingClientRect();
			const plotTopInStack = canvasRect.top - stackRect.top + chartArea.top;
			const plotBottomInStack = canvasRect.top - stackRect.top + chartArea.bottom;
			const spaceBelowPlot = Math.max(0, stackRect.height - plotBottomInStack);
			const topRequired = Math.max(0, gridHalfHeight - plotTopInStack);
			const bottomRequired = Math.max(0, gridHalfHeight - spaceBelowPlot);
			const withSafetyPixel = (required) => required > 0 ? Math.ceil(required) + 1 : 0;
			return {
				top: Math.max(chartYPaddingPx, withSafetyPixel(topRequired)),
				bottom: Math.max(chartYPaddingPx, withSafetyPixel(bottomRequired)),
			};
		};
		priceChartYPadding = resolvePriceChartYPadding();
		applyBacktestYAxisScale(
			priceChart,
			priceCanvas,
			[priceChart.data.datasets[0].data],
			priceChartYPadding,
		);
		priceChart.update("none");
		const scheduleChartLayoutRefresh = () => {
			if (layoutFrameId !== null || controllerDestroyed) return;
			layoutFrameId = requestControllerAnimationFrame(() => {
				layoutFrameId = null;
				if (!priceChart?.ctx || !equityChart?.ctx) return;
				const refreshIndex = pinState.mode === "pinned"
					? pinState.activeIndex
					: activeIndex;
				const refreshSourceCanvas = pinState.mode === "pinned"
					? priceCanvas
					: activeSourceCanvas;
				const refreshSourceChart = pinState.mode === "pinned"
					? priceChart
					: activeSourceChart;
				priceChart.resize();
				equityChart.resize();
				priceChartYPadding = resolvePriceChartYPadding();
				applyBacktestYAxisScale(
					priceChart,
					priceCanvas,
					[priceChart.data.datasets[0].data],
					priceChartYPadding,
				);
				applyBacktestYAxisScale(
					equityChart,
					equityCanvas,
					[equityChart.data.datasets[0].data, equityChart.data.datasets[1].data],
					chartYPaddingPx,
				);
				if (Number.isInteger(refreshIndex) && refreshSourceCanvas && refreshSourceChart?.ctx) {
					syncHoverState(refreshIndex, refreshSourceCanvas, refreshSourceChart);
				} else {
					priceChart.update("none");
					equityChart.update("none");
				}
			});
		};
		if (typeof ResizeObserver === "function") {
			layoutObserver = new ResizeObserver(scheduleChartLayoutRefresh);
			layoutObserver.observe(tradeChartStack);
		}
		window.addEventListener("resize", scheduleChartLayoutRefresh, {signal: documentController.signal});
		scheduleChartLayoutRefresh();
		const clearPinnedProbabilityField = () => {
			if (pinState.mode !== "pinned") return;
			pinState = probabilityGridApi.reducePinState?.(pinState, {type: "clear"})
				|| {mode: "tracking", activeIndex: null};
			syncHoverState(null, priceCanvas, priceChart);
		};
		document.addEventListener("click", (event) => {
			if (pinState.mode !== "pinned") return;
			const path = typeof event.composedPath === "function" ? event.composedPath() : [];
			if (path.includes(priceCanvas) || (probabilityTooltip && path.includes(probabilityTooltip))) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest("button, a, input, select, textarea, [role='button'], [role='link']")) return;
			clearPinnedProbabilityField();
		}, {capture: true, signal: documentController.signal});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape") clearPinnedProbabilityField();
		}, {signal: documentController.signal});
		const hoverController = {
			destroy() {
				if (controllerDestroyed) return;
				controllerDestroyed = true;
				cancelScheduledHoverSync();
				if (layoutFrameId !== null) {
					cancelControllerAnimationFrame(layoutFrameId);
					layoutFrameId = null;
				}
				layoutObserver?.disconnect?.();
				layoutObserver = null;
				themeCleanup?.();
				themeCleanup = null;
				documentController.abort();
				priceCanvas._abortController?.abort?.();
				equityCanvas._abortController?.abort?.();
				priceCanvas._abortController = null;
				equityCanvas._abortController = null;
				controllerAnimationFrames.forEach((frameId) => window.cancelAnimationFrame(frameId));
				controllerAnimationFrames.clear();
				controllerTaskCleanups.splice(0).forEach((cleanup) => cleanup());
				activateBacktestRows([], null);
				hoverLine.remove();
				tooltip.remove();
				probabilityTooltip?.remove();
				priceChart?.destroy?.();
				equityChart?.destroy?.();
				if (bootstrap.backtestHoverController === hoverController) {
					bootstrap.backtestHoverController = null;
				}
			},
		};
		bootstrap.backtestHoverController = hoverController;
		themeCleanup = bindColorSchemeRefresh(() => {
			if (controllerDestroyed || !priceChart?.ctx || !equityChart?.ctx) return;
			const nextTheme = readThemeTokens();
			Object.assign(resolvedTheme, nextTheme);
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
			priceChart.update("none");
			equityChart.update("none");
		});
		initTransactionsPagination();
		if (refreshTransition) {
			const cleanupRefreshTransition = animateBacktestRefreshTransition(
				priceChart,
				equityChart,
				refreshTransition,
				close,
				equity,
				allInEquity,
				() => priceChartYPadding,
				() => chartYPaddingPx,
			);
			if (typeof cleanupRefreshTransition === "function") {
				controllerTaskCleanups.push(cleanupRefreshTransition);
			}
		}
	};

	const share = () => bootstrap.workspaceShare || {};

	const buildBacktestShareFilename = () => {
		const ticker = String(window.ANTIGRAVITY_APP?.backtestResult?.summary?.ticker || "").trim().toLowerCase() || "backtest";
		return share().buildFilename?.("backtest", ticker) || `backtest-${ticker}.png`;
	};

	bootstrap.registerWorkspaceShareProvider?.("backtest", {
		isReady: () => Boolean(window.ANTIGRAVITY_APP?.backtestResult) && share().areTradeChartsReady?.(),
		buildCard: () => share().buildTradeCard?.({
			shareView: "backtest",
			title: document.querySelector(".workspace-mode-results-stack .workspace-summary-card .report-heading")?.textContent?.trim()
				|| "Backtest",
		}),
		buildFilename: buildBacktestShareFilename,
		onAnchorClick: () => {
			window.location.assign(`/api/export-transactions${window.location.search}`);
		},
	});

	bootstrap.initBacktestWorkspace = initBacktestWorkspace;
	initBacktestWorkspace();
})();
