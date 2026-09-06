/* Code version: v1.2.0 */
/**
 * Owns the synchronized Price/Equity chart runtime, including probability-field
 * DOM, pointer capture, caches, animation frames, observers, and teardown.
 * The workspace supplies data and preferences; distribution adapters supply math.
 */
(function bootstrapBacktestChartController(globalScope) {
	"use strict";
	const bootstrap = globalScope.WORTHWARD_BOOTSTRAP = globalScope.WORTHWARD_BOOTSTRAP || {};
	const backtestThemeState = bootstrap.backtestThemeState = bootstrap.backtestThemeState || {};
	const chartAxis = window.WORTHWARD_CHART_AXIS || {};
	const probabilityGridApi = window.WORTHWARD_BACKTEST_PROBABILITY_GRID || {};
	const PROBABILITY_STAGE_MINIMUM_PROPERTY = "--backtest-probability-stage-min-height";
	const PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT = "worthward:backtest-probability-stage-minimum-change";
	const BACKTEST_HISTORY_VIEW_CHANGE_EVENT = "worthward:backtest-history-view-change";
	const PROBABILITY_MODEL_CACHE_LIMIT = 24;
	let detailModulePromise = null;
	const loadDetailModule = () => {
		if (window.WORTHWARD_PRICE_FIELD_DETAIL_CHART) return Promise.resolve();
		if (!detailModulePromise) detailModulePromise = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = "/static/assets/js/backtest/detail-chart.js?v=backtest-detail-chart-v1.1.0";
			script.onload = () => window.WORTHWARD_PRICE_FIELD_DETAIL_CHART
				? resolve() : reject(new Error("Price Field detail module is unavailable."));
			script.onerror = () => reject(new Error("Price Field detail module could not be loaded."));
			document.head.appendChild(script);
		});
		return detailModulePromise;
	};


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
		window.addEventListener("worthward:theme-mode-change", handler);
		cleanups.push(() => window.removeEventListener("worthward:theme-mode-change", handler));
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
		const scheduler = window.WorthwardMotion?.scheduler;
		if (scheduler?.animate) {
			return scheduler.animate({
				key: 'backtest-refresh-transition',
				duration: window.WorthwardMotion?.durations?.emphasized ?? 420,
				ease: window.WorthwardMotion?.easing?.emphasized,
				update: applyProgress,
				complete: () => applyProgress(1),
			});
		} else {
			applyProgress(1);
		}
		return null;
	};

	const mountCharts = (state, isBacktestTradeDetailsEnabled, distributionRegistry) => {
		const resultsStack = document.querySelector(
			".backtest-results-stack.investment-workspace-header",
		);
		const clearProbabilityStageMinimum = () => {
			if (!(resultsStack instanceof HTMLElement)) return;
			const hadMinimum = Boolean(
				resultsStack.style.getPropertyValue(PROBABILITY_STAGE_MINIMUM_PROPERTY),
			);
			resultsStack.style.removeProperty(PROBABILITY_STAGE_MINIMUM_PROPERTY);
			delete resultsStack.dataset.backtestProbabilityStageMinimum;
			if (hadMinimum) {
				resultsStack.dispatchEvent(new Event(PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT));
			}
		};
		const resetProbabilityScrollPort = () => {
			resultsStack?.classList.remove("has-probability-scrollport");
			const scrollPort = resultsStack?.querySelector("[data-backtest-probability-scrollport]");
			if (!(scrollPort instanceof HTMLElement)) return;
			scrollPort.scrollLeft = 0;
			scrollPort.tabIndex = -1;
			scrollPort.hidden = true;
			scrollPort.setAttribute("aria-hidden", "true");
			const sectionResizer = resultsStack?.querySelector("#backtest_section_resizer");
			if (sectionResizer instanceof HTMLElement) {
				sectionResizer.removeAttribute("aria-hidden");
				sectionResizer.removeAttribute("tabindex");
			}
		};
		const probabilityDetailPanel = document.getElementById("backtest_probability_detail_panel");
		const probabilityDetailGrid = probabilityDetailPanel?.querySelector(
			"[data-backtest-probability-detail-grid]",
		);
		const probabilityDetailYAxis = probabilityDetailPanel?.querySelector(
			"[data-backtest-probability-detail-y-axis]",
		);
		const probabilityDetailXAxis = probabilityDetailPanel?.querySelector(
			"[data-backtest-probability-detail-x-axis]",
		);
		const probabilityDetailStatus = probabilityDetailPanel?.querySelector(
			"[data-backtest-probability-detail-status]",
		);
		const probabilityDetailAnchor = probabilityDetailPanel?.querySelector(
			"[data-backtest-probability-detail-anchor]",
		);
		const probabilityDetailUpSummary = probabilityDetailPanel?.querySelector(
			"[data-backtest-probability-detail-up-summary]",
		);
		const probabilityDetailDownSummary = probabilityDetailPanel?.querySelector(
			"[data-backtest-probability-detail-down-summary]",
		);
		let latestProbabilityDetailIndex = null;
		let latestProbabilityDetailModel = null;
		let latestProbabilityDetailBaseStatus = "";
		let activeProbabilityDetailRow = null;
		const probabilityDetailXAxisTickNodes = new Map();
		const clearProbabilityDetailRowHover = () => {
			activeProbabilityDetailRow = null;
			if (probabilityDetailGrid instanceof HTMLElement) {
				delete probabilityDetailGrid.dataset.hoveredRow;
				delete probabilityDetailGrid.dataset.hoverSummary;
				probabilityDetailGrid.removeAttribute("title");
				probabilityDetailGrid.querySelectorAll(".backtest-probability-detail-cell").forEach((cell) => {
					cell.classList.remove("is-row-hovered");
					if (cell.dataset.baseTitle) {
						cell.setAttribute("title", cell.dataset.baseTitle);
					} else {
						cell.removeAttribute("title");
					}
				});
			}
			if (probabilityDetailStatus instanceof HTMLElement && latestProbabilityDetailBaseStatus) {
				probabilityDetailStatus.textContent = latestProbabilityDetailBaseStatus;
			}
		};
		const renderProbabilityDetailRowHover = (row) => {
			const summary = probabilityGridApi.summarizeProbabilityRow?.(
				latestProbabilityDetailModel?.cells,
				row,
			);
			if (!summary || !(probabilityDetailGrid instanceof HTMLElement)) return false;
			activeProbabilityDetailRow = summary.row;
			probabilityDetailGrid.dataset.hoveredRow = String(summary.row);
			const hoverSummary = [
				`Price interval: ${formatMoney(summary.lowerPrice)}–${formatMoney(summary.upperPrice)}`,
				`Cumulative probability across all ${summary.cellCount} forecast cells: ${(summary.cumulativeProbability * 100).toFixed(2)}%`,
				`including ${summary.hiddenCellCount} hidden`,
			].join(" · ");
			probabilityDetailGrid.dataset.hoverSummary = hoverSummary;
			probabilityDetailGrid.setAttribute("title", hoverSummary);
			probabilityDetailGrid.querySelectorAll(".backtest-probability-detail-cell").forEach((cell) => {
				const isHoveredRow = Number(cell.dataset.row) === summary.row;
				cell.classList.toggle("is-row-hovered", isHoveredRow);
				if (isHoveredRow) {
					if (!cell.dataset.baseTitle) cell.dataset.baseTitle = cell.getAttribute("title") || "";
					cell.setAttribute("title", hoverSummary);
				} else if (cell.dataset.baseTitle) {
					cell.setAttribute("title", cell.dataset.baseTitle);
				}
			});
			return true;
		};
		const formatProbabilityMass = (value) => `${new Intl.NumberFormat("en-US", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(Math.max(0, Number(value) || 0) * 100)}%`;
		const renderProbabilityDetailSideSummary = (cells) => {
			const summary = probabilityGridApi.summarizeProbabilityField?.(cells);
			if (!summary) {
				[probabilityDetailUpSummary, probabilityDetailDownSummary].forEach((element) => {
					if (!(element instanceof HTMLElement)) return;
					element.textContent = "—";
					element.title = "Directional share unavailable: no represented probability mass";
					element.setAttribute("aria-label", element.title);
				});
				return false;
			}
			// Round once in hundredths of a percent; the other label is the exact complement.
			const upUnits = Math.round(summary.upProbability * 10000);
			const upText = formatProbabilityMass(upUnits / 10000);
			const downText = formatProbabilityMass((10000 - upUnits) / 10000);
			const horizonDescription = `${summary.forecastHorizonCount} forecast horizons`;
			if (probabilityDetailUpSummary instanceof HTMLElement) {
				probabilityDetailUpSummary.textContent = upText;
				probabilityDetailUpSummary.setAttribute(
					"aria-label",
					`Higher-price share of represented probability mass: ${upText}`,
				);
				probabilityDetailUpSummary.title = `Higher-price share, normalized within each complete grid horizon then averaged across ${horizonDescription}, including ${summary.upHiddenCellCount} hidden cells; excludes mass outside the lattice: ${upText}`;
			}
			if (probabilityDetailDownSummary instanceof HTMLElement) {
				probabilityDetailDownSummary.textContent = downText;
				probabilityDetailDownSummary.setAttribute(
					"aria-label",
					`Lower-price share of represented probability mass: ${downText}`,
				);
				probabilityDetailDownSummary.title = `Lower-price share, normalized within each complete grid horizon then averaged across ${horizonDescription}, including ${summary.downHiddenCellCount} hidden cells; excludes mass outside the lattice: ${downText}`;
			}
			return true;
		};
		const hideProbabilityDetail = () => {
			if (!(probabilityDetailPanel instanceof HTMLElement)) return;
			clearProbabilityDetailRowHover();
			latestProbabilityDetailModel = null;
			latestProbabilityDetailBaseStatus = "";
			latestProbabilityDetailIndex = null;
			probabilityDetailPanel.hidden = true;
			probabilityDetailPanel.setAttribute("aria-hidden", "true");
			delete probabilityDetailPanel.dataset.activeIndex;
			delete probabilityDetailPanel.dataset.renderKey;
		};
		const isProbabilityHistoryViewActive = () => (
			document.getElementById("backtest_history_surface")?.dataset.activeView === "probability"
		);
		if (!state || state.currentView !== "backtest" || state.selectedStrategyId === "dca" || !window.Chart || !state.backtestResult) {
			resultsStack?.classList.remove("has-probability-field");
			clearProbabilityStageMinimum();
			resetProbabilityScrollPort();
			hideProbabilityDetail();
			return;
		}

		const priceCanvas = document.getElementById("tradePriceChart");
		const equityCanvas = document.getElementById("tradeEquityChart");
		if (!priceCanvas || !equityCanvas) {
			resultsStack?.classList.remove("has-probability-field");
			clearProbabilityStageMinimum();
			resetProbabilityScrollPort();
			hideProbabilityDetail();
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
		let strategyPresentation = typeof probabilityGridApi.normalizePresentation === "function"
			? probabilityGridApi.normalizePresentation(
				backtestResult.strategy_presentation,
				{raw_dates: rawDates, length: close.length},
			)
			: null;
		const distribution = distributionRegistry.resolve(strategyPresentation?.distribution_kind);
		if (!distribution) strategyPresentation = null;
		resultsStack?.classList.toggle("has-probability-field", Boolean(strategyPresentation));
		if (!strategyPresentation) {
			clearProbabilityStageMinimum();
			resetProbabilityScrollPort();
		}
		
		const interval = backtestResult.interval || "1d";
		const rawTimestamps = rawDates.map((value) => {
			const parsed = Date.parse(value);
			return Number.isFinite(parsed) ? parsed : null;
		});
		const resolveProbabilityFieldReferenceCellSize = (chart, stepPixels) => {
			const chartArea = chart?.chartArea;
			const plotWidth = Number(chartArea?.right) - Number(chartArea?.left);
			const timestamps = rawTimestamps
				.filter((value) => Number.isFinite(value))
				.sort((left, right) => left - right);
			if (!(plotWidth > 0) || !(stepPixels > 0) || timestamps.length < 2) return null;
			const rangeStart = timestamps[0];
			const rangeEnd = timestamps[timestamps.length - 1];
			if (!(rangeEnd > rangeStart)) return null;
			const referenceStartDate = new Date(rangeEnd);
			referenceStartDate.setUTCMonth(referenceStartDate.getUTCMonth() - 3);
			const referenceStart = referenceStartDate.getTime();
			const referenceWindow = rangeEnd - referenceStart;
			const trailingReferenceCount = timestamps.filter(
				(value) => value >= referenceStart,
			).length;
			const hasFullReferenceWindow = (rangeEnd - rangeStart) >= (referenceWindow * 0.9);
			const referencePointCount = hasFullReferenceWindow && trailingReferenceCount >= 2
				? trailingReferenceCount
				: Math.max(
					2,
					Math.round(
						(referenceWindow / (rangeEnd - rangeStart))
						* (timestamps.length - 1),
					) + 1,
				);
			const referenceStepPixels = plotWidth / (referencePointCount - 1);
			if (!(referenceStepPixels > 0)) return null;
			const referenceGeometry = probabilityGridApi.computeGridGeometry?.({
				chartArea,
				anchorX: Number(chartArea.left),
				anchorY: (Number(chartArea.top) + Number(chartArea.bottom)) / 2,
				columnCount: strategyPresentation.columns,
				widthFraction: strategyPresentation.width_fraction,
				gapPx: strategyPresentation.gap_px,
				paddingPx: strategyPresentation.padding_px,
				minCellPx: strategyPresentation.min_cell_px,
				rowsAbove: strategyPresentation.rows_above,
				rowsBelow: strategyPresentation.rows_below,
				stepPixels: referenceStepPixels,
			});
			return referenceGeometry?.cellSize > 0 ? referenceGeometry.cellSize : null;
		};
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

		const tradeChartStack = priceCanvas.closest(".trade-chart-stack");
		if (!tradeChartStack) {
			clearProbabilityStageMinimum();
			hideProbabilityDetail();
			return;
		}
		const stackedLayoutMedia = typeof window.WORTHWARD_RESPONSIVE?.media === "function"
			? window.WORTHWARD_RESPONSIVE.media("contentStackMax")
			: null;
		const fixedYAxisWidth = readPxToken(tradeChartStack, "--backtest-chart-y-axis-width", 72);
		tradeChartStack.classList.toggle("has-probability-field", Boolean(strategyPresentation));
		const probabilityScrollPort = strategyPresentation
			? resultsStack?.querySelector("[data-backtest-probability-scrollport]")
			: null;
		const probabilityScrollPortSpacer = probabilityScrollPort?.querySelector(
			"[data-backtest-probability-scrollport-spacer]",
		);
		const probabilityScrollResizer = resultsStack?.querySelector("#backtest_section_resizer");
		const isProbabilityAuxiliarySurface = (target) => (
			target instanceof Node
			&& (
				(probabilityScrollPort instanceof HTMLElement && probabilityScrollPort.contains(target))
				|| (probabilityScrollResizer instanceof HTMLElement && probabilityScrollResizer.contains(target))
			)
		);
		if (probabilityScrollPort instanceof HTMLElement) {
			probabilityScrollPort.scrollLeft = 0;
			probabilityScrollPort.tabIndex = -1;
			probabilityScrollPort.hidden = true;
			probabilityScrollPort.setAttribute("aria-hidden", "true");
		}
		const chartYPaddingPx = readPxToken(tradeChartStack, "--trade-chart-y-padding-px", 5);
		const chartAxisStyles = getComputedStyle(tradeChartStack);
		const chartAxisFontFamily = chartAxisStyles.getPropertyValue(
			"--backtest-chart-axis-font-family",
		).trim() || '"GDS Transport", "Helvetica Neue", Arial, sans-serif';
		const chartAxisFontSize = readPxToken(tradeChartStack, "--backtest-chart-axis-font-size", 12);
		const chartAxisFontWeight = chartAxisStyles.getPropertyValue(
			"--backtest-chart-axis-font-weight",
		).trim() || "400";
		const chartAxisLineHeight = readPxToken(tradeChartStack, "--backtest-chart-axis-line-height", 10);
		const chartAxisCanvasFont = `${chartAxisFontWeight} ${chartAxisFontSize}px ${chartAxisFontFamily}`;
		let priceChartYPadding = chartYPaddingPx;
		const existingHoverLine = tradeChartStack.querySelector(".trade-chart-hover-line");
		if (existingHoverLine) existingHoverLine.remove();
		const hoverLine = document.createElement("div");
		hoverLine.className = "trade-chart-hover-line";
		tradeChartStack.appendChild(hoverLine);
		const existingHoverCrosshairLine = tradeChartStack.querySelector(
			".trade-chart-hover-horizontal-line",
		);
		if (existingHoverCrosshairLine) existingHoverCrosshairLine.remove();
		const hoverCrosshairLine = document.createElement("div");
		hoverCrosshairLine.className = "trade-chart-hover-horizontal-line";
		tradeChartStack.appendChild(hoverCrosshairLine);
		const hoverDateLabel = document.createElement("div");
		hoverDateLabel.className = "trade-chart-hover-date-label";
		hoverDateLabel.dataset.backtestHoverDateLabel = "";
		hoverDateLabel.setAttribute("aria-hidden", "true");
		hoverDateLabel.innerHTML = `
			<span data-backtest-hover-date-line="primary"></span>
			<span data-backtest-hover-date-line="secondary"></span>
		`;
		hoverDateLabel.hidden = true;
		tradeChartStack.appendChild(hoverDateLabel);
		// A separate paint surface keeps price ticks and their value badge fixed
		// while only the plot moves through the horizontal viewport.
		const fixedPriceAxis = strategyPresentation ? document.createElement("canvas") : null;
		const probabilityHint = strategyPresentation ? document.createElement("div") : null;
		if (fixedPriceAxis) {
			fixedPriceAxis.className = "backtest-fixed-price-axis";
			fixedPriceAxis.setAttribute("aria-hidden", "true");
			tradeChartStack.appendChild(fixedPriceAxis);
			probabilityHint.className = "backtest-probability-hint";
			probabilityHint.hidden = true;
			tradeChartStack.appendChild(probabilityHint);
		}

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
		const probabilityScrollSpacer = strategyPresentation ? document.createElement("span") : null;
		if (probabilityScrollSpacer) {
			probabilityScrollSpacer.className = "backtest-probability-scroll-spacer";
			probabilityScrollSpacer.dataset.backtestProbabilityScrollSpacer = "";
			probabilityScrollSpacer.setAttribute("aria-hidden", "true");
			tradeChartStack.appendChild(probabilityScrollSpacer);
		}
		const probabilityCanvas = strategyPresentation ? document.createElement("canvas") : null;
		if (probabilityTooltip) {
			probabilityTooltip.className = "chart-tooltip backtest-probability-tooltip";
			probabilityTooltip.dataset.backtestChartTooltip = "probability-grid";
			probabilityTooltip.dataset.renderer = strategyPresentation.renderer;
			probabilityTooltip.dataset.targetInterval = String(
				strategyPresentation.target_interval || "next-open-to-following-open",
			);
			probabilityTooltip.dataset.priceAnchorKind = String(
				strategyPresentation.price_anchor_kind || "signal-close-display-anchor",
			);
			probabilityTooltip.dataset.cellOpacityMapping = strategyPresentation.cell_opacity_mapping;
			probabilityTooltip.dataset.cellOpacityExponent = String(
				strategyPresentation.cell_opacity_exponent,
			);
			probabilityTooltip.dataset.cellOpacityTailRatio = String(
				strategyPresentation.cell_opacity_tail_ratio,
			);
			probabilityTooltip.dataset.cellDisplayThresholdPct = String(
				strategyPresentation.cell_display_threshold_pct,
			);
			probabilityTooltip.style.left = "0px";
			probabilityTooltip.style.top = "0px";
			probabilityTooltip.setAttribute("role", "img");
			probabilityTooltip.setAttribute(
				"aria-label",
				"Future price probability field; displayed from the signal-close anchor; executable target is next-open to-following-open",
			);
			if (probabilityCanvas) {
				probabilityCanvas.className = "backtest-probability-canvas";
				probabilityCanvas.setAttribute("aria-hidden", "true");
			}
			const probabilityGrid = document.createElement("div");
			probabilityGrid.className = "backtest-probability-grid";
			probabilityGrid.dataset.backtestProbabilityGrid = "";
			probabilityGrid.setAttribute("aria-hidden", "true");
			if (probabilityCanvas) probabilityTooltip.appendChild(probabilityCanvas);
			probabilityTooltip.appendChild(probabilityGrid);
			probabilityTooltip.hidden = true;
			tradeChartStack.appendChild(probabilityTooltip);
		}
		const probabilityScrollVisualNodes = [
			priceCanvas.closest(".trade-chart-panel"),
			equityCanvas.closest(".trade-chart-panel"),
			hoverLine,
			hoverCrosshairLine,
			tooltip,
			probabilityTooltip,
			hoverDateLabel,
		].filter((node) => node instanceof HTMLElement);
		const probabilityScrollVisualTranslations = new Map(
			probabilityScrollVisualNodes.map((node) => [node, node.style.translate]),
		);

		const formatMoney = (value) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
		const formatReturn = (value) => `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}%`;

		let activeIndex = null;
		let activePriceOverlay = false;
		let activeSourceCanvas = null;
		let activeSourceChart = null;
		let pinState = {mode: "tracking", activeIndex: null};
		let priceChart;
		let equityChart;
		const chartHoverPointCaches = new Map();
		const probabilityModelCache = new Map();
		let probabilityHoverLayout = null;
		const getChartHoverPointCache = (chart) => {
			if (!chart) return {points: [], finitePoints: []};
			const points = chart.getDatasetMeta?.(0)?.data || [];
			const chartArea = chart.chartArea;
			const signature = [
				chart.width,
				chart.height,
				chartArea?.left,
				chartArea?.right,
				chartArea?.top,
				chartArea?.bottom,
				points.length,
			].join("|");
			const cached = chartHoverPointCaches.get(chart);
			if (cached?.points === points && cached.signature === signature) return cached;
			const finitePoints = [];
			points.forEach((point, index) => {
				if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
					finitePoints.push({index, x: point.x, y: point.y});
				}
			});
			const next = {points, finitePoints, signature};
			chartHoverPointCaches.set(chart, next);
			return next;
		};
		const getProbabilityHoverLayout = () => {
			if (!strategyPresentation || !priceChart?.chartArea) return null;
			const pointCache = getChartHoverPointCache(priceChart);
			const chartArea = priceChart.chartArea;
			const yScale = priceChart.scales?.y;
			const signature = [
				priceChart.width,
				priceChart.height,
				chartArea.left,
				chartArea.right,
				chartArea.top,
				chartArea.bottom,
				yScale?.min,
				yScale?.max,
				pointCache.signature,
				strategyPresentation.columns,
				strategyPresentation.rows_above,
				strategyPresentation.rows_below,
				strategyPresentation.width_fraction,
				strategyPresentation.gap_px,
				strategyPresentation.padding_px,
				strategyPresentation.min_cell_px,
				strategyPresentation.cell_opacity_mapping,
				strategyPresentation.cell_opacity_exponent,
				strategyPresentation.cell_opacity_tail_ratio,
				strategyPresentation.cell_display_threshold_pct,
			].join("|");
			if (
				probabilityHoverLayout?.signature === signature
				&& probabilityHoverLayout.points === pointCache.points
			) return probabilityHoverLayout;
			const stepPixels = probabilityGridApi.resolveDatasetStepPixels?.(pointCache.points, 0);
			if (!(stepPixels > 0)) return null;
			const cellSizeTargetPx = resolveProbabilityFieldReferenceCellSize(priceChart, stepPixels);
			probabilityModelCache.clear();
			probabilityHoverLayout = {
				cellSizeTargetPx,
				points: pointCache.points,
				signature,
				stepPixels,
			};
			return probabilityHoverLayout;
		};
		const publishProbabilityStageMinimum = () => {
			if (
				!strategyPresentation
				|| !(resultsStack instanceof HTMLElement)
				|| !priceChart?.chartArea
			) {
				clearProbabilityStageMinimum();
				return;
			}
			const hoverLayout = getProbabilityHoverLayout();
			if (!hoverLayout) return;
			const pricePoints = hoverLayout.points;
			const {cellSizeTargetPx, stepPixels} = hoverLayout;
			const requirement = probabilityGridApi.computeGridMinimumPlotHeight?.({
				chartArea: priceChart.chartArea,
				columnCount: strategyPresentation.columns,
				gapPx: strategyPresentation.gap_px,
				minCellPx: strategyPresentation.min_cell_px,
				paddingPx: strategyPresentation.padding_px,
				rowsAbove: strategyPresentation.rows_above,
				rowsBelow: strategyPresentation.rows_below,
				stepPixels,
				cellSizeTargetPx,
				widthFraction: strategyPresentation.width_fraction,
			});
			if (!requirement) return;
			const canvasRect = priceCanvas.getBoundingClientRect();
			const stackRect = tradeChartStack.getBoundingClientRect();
			const chartHeight = Number(priceChart.height);
			const chartAreaHeight = Number(priceChart.chartArea.bottom)
				- Number(priceChart.chartArea.top);
			if (
				!(canvasRect.height > 0)
				|| !(stackRect.height > 0)
				|| !(chartHeight > 0)
				|| !(chartAreaHeight > 0)
			) return;
			const canvasScaleY = canvasRect.height / chartHeight;
			const currentPlotHeight = chartAreaHeight * canvasScaleY;
			const chartAreaCenterY = (
				Number(priceChart.chartArea.top) + Number(priceChart.chartArea.bottom)
			) / 2;
			const centralAnchor = pricePoints.reduce((closest, point, index) => {
				const mean = strategyPresentation.predictive_mean?.[index];
				const scale = strategyPresentation.predictive_scale?.[index];
				const pointY = Number(point?.y);
				if (
					mean === null || mean === undefined
					|| scale === null || scale === undefined
					|| !Number.isFinite(pointY)
					|| !(Number(scale) > 0)
				) return closest;
				const distance = Math.abs(pointY - chartAreaCenterY);
				return !closest || distance < closest.distance
					? {distance, pointY}
					: closest;
			}, null);
			const centerOffsetRatio = centralAnchor
				? centralAnchor.distance / chartAreaHeight
				: Number.POSITIVE_INFINITY;
			// Reserve for a real forecastable curve point near the visual midpoint,
			// not only an imaginary mathematically centered guide. Off-center and
			// edge hovers remain governed by their own chart boundary.
			const minimumBoundaryRatio = centerOffsetRatio <= 0.1
				? Math.max(0.01, 0.5 - centerOffsetRatio)
				: 0.5;
			const requiredChartAreaHeight = requirement.chartAreaMinimumHeight
				/ (2 * minimumBoundaryRatio);
			const requiredPlotHeight = requiredChartAreaHeight * canvasScaleY;
			const chartChromeHeight = Math.max(0, canvasRect.height - currentPlotHeight);
			const pricePanelShare = canvasRect.height / stackRect.height;
			if (!(pricePanelShare > 0)) return;
			const stageMinimum = Math.ceil(
				(requiredPlotHeight + chartChromeHeight) / pricePanelShare,
			);
			if (!Number.isFinite(stageMinimum) || !(stageMinimum > 0)) return;
			const priorMinimum = Number.parseFloat(
				resultsStack.style.getPropertyValue(PROBABILITY_STAGE_MINIMUM_PROPERTY),
			);
			if (Number.isFinite(priorMinimum) && Math.abs(priorMinimum - stageMinimum) < 1) return;
			resultsStack.style.setProperty(
				PROBABILITY_STAGE_MINIMUM_PROPERTY,
				`${stageMinimum}px`,
			);
			resultsStack.dataset.backtestProbabilityStageMinimum = String(stageMinimum);
			resultsStack.dispatchEvent(new Event(PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT));
		};
		const documentController = new AbortController();
		if (probabilityDetailGrid instanceof HTMLElement) {
			probabilityDetailGrid.addEventListener("pointermove", (event) => {
				const target = event.target instanceof Element
					? event.target.closest(".backtest-probability-detail-cell")
					: null;
				if (!(target instanceof HTMLElement) || !probabilityDetailGrid.contains(target)) {
					if (activeProbabilityDetailRow !== null) clearProbabilityDetailRowHover();
					return;
				}
				const row = Number(target.dataset.row);
				if (row === activeProbabilityDetailRow) return;
				renderProbabilityDetailRowHover(row);
			}, {signal: documentController.signal});
			probabilityDetailGrid.addEventListener("pointerleave", clearProbabilityDetailRowHover, {
				signal: documentController.signal,
			});
		}
		const controllerAnimationFrames = new Set();
		const controllerTaskCleanups = [];
		let controllerDestroyed = false;
		let hoverFrameId = null;
		let pointerHoverFrameId = null;
		let pendingHoverUpdate = null;
		let layoutFrameId = null;
		let detailModulePending = false;
		let detailModuleFailed = false;
		let probabilityDetailRefreshFrameId = null;
		let probabilityDetailRefreshPasses = 0;
		let probabilityDetailLayoutObserver = null;
		let themeCleanup = null;
		let probabilityScrollTarget = 0;
		let probabilityScrollVisualPosition = 0;
		let probabilityScrollVisualOffset = 0;
		let probabilityScrollVelocity = 0;
		let probabilityScrollLastTimestamp = null;
		let probabilityScrollCleanup = null;
		let isSynchronizingProbabilityScrollPort = false;
		let isUpdatingProbabilityFieldPosition = false;
		let probabilityScrollPortIsActive = false;
		let probabilityScrollStackWidth = 0;
		let probabilityScrollPortWidth = 0;
		let probabilityScrollExtentDistance = 0;
		let probabilityHoverPointerX = null;
		let probabilityHoverPointerY = null;
		let probabilityHoverPointerActive = false;
		let probabilityHoverIntersection = null;
		let probabilityPanGesture = null;
		let probabilityManualPanOffset = 0;
		let probabilityFieldPositionUpdater = null;
		const resetProbabilityHoverPointer = () => {
			probabilityManualPanOffset = 0;
			probabilityHoverPointerX = null;
			probabilityHoverPointerY = null;
			probabilityHoverPointerActive = false;
			probabilityHoverIntersection = null;
		};
		const setInlineStyleIfChanged = (element, propertyName, value) => {
			if (!(element instanceof HTMLElement)) return;
			if (element.style.getPropertyValue(propertyName) === value) return;
			element.style.setProperty(propertyName, value);
		};
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
		const setProbabilityScrollVisualOffset = (offsetValue) => {
			const nextOffset = Number(offsetValue) || 0;
			if (Math.abs(probabilityScrollVisualOffset - nextOffset) <= 0.001) return;
			probabilityScrollVisualOffset = nextOffset;
			tradeChartStack.dataset.probabilityPanVisualOffset = String(
				probabilityScrollVisualOffset,
			);
			probabilityScrollVisualNodes.forEach((node) => {
				const nextTranslate = Math.abs(probabilityScrollVisualOffset) <= 0.001
					? probabilityScrollVisualTranslations.get(node)
					: `${probabilityScrollVisualOffset}px 0px`;
				if (node.style.translate !== nextTranslate) node.style.translate = nextTranslate;
			});
		};
		const setProbabilityScrollPortActive = (active) => {
			const isActive = Boolean(active) && probabilityScrollPort instanceof HTMLElement;
			if (probabilityScrollPortIsActive === isActive) return;
			probabilityScrollPortIsActive = isActive;
			resultsStack?.classList.toggle("has-probability-scrollport", isActive);
			if (!(probabilityScrollPort instanceof HTMLElement)) return;
			probabilityScrollPort.hidden = !isActive;
			probabilityScrollPort.tabIndex = isActive ? 0 : -1;
			probabilityScrollPort.setAttribute("aria-hidden", isActive ? "false" : "true");
			if (!isActive) {
				isSynchronizingProbabilityScrollPort = true;
				probabilityScrollPort.scrollLeft = 0;
				isSynchronizingProbabilityScrollPort = false;
			}
		};
		const setProbabilityScrollExtent = (scrollDistance) => {
			if (!probabilityScrollSpacer) return;
			const distance = Math.max(0, Number(scrollDistance) || 0);
			const nextDistance = Math.max(probabilityScrollExtentDistance, distance);
			const stackWidth = probabilityScrollStackWidth > 0
				? probabilityScrollStackWidth
				: tradeChartStack.clientWidth;
			const stackScrollWidth = Math.ceil(stackWidth + nextDistance);
			setInlineStyleIfChanged(probabilityScrollSpacer, "display", "block");
			setInlineStyleIfChanged(
				probabilityScrollSpacer,
				"left",
				`${Math.max(0, stackScrollWidth - 1)}px`,
			);
            if (
                probabilityScrollPort instanceof HTMLElement
                && probabilityScrollPortSpacer instanceof HTMLElement
            ) {
                const measuredPortWidth = Math.max(0, probabilityScrollPort.clientWidth);
                if (measuredPortWidth > 0) probabilityScrollPortWidth = measuredPortWidth;
                const portViewportWidth = Math.max(
                    1,
                    probabilityScrollPortWidth,
                    measuredPortWidth,
                );
                const portWidth = probabilityScrollPort.hidden
                    ? 1
                    : Math.ceil(portViewportWidth + nextDistance);
                setInlineStyleIfChanged(probabilityScrollPortSpacer, "width", `${portWidth}px`);
            }
			probabilityScrollExtentDistance = nextDistance;
		};
		const setProbabilityScrollPosition = (scrollLeft) => {
			const next = Math.max(0, Number(scrollLeft) || 0);
			const nativeScrollLeft = Math.ceil(next);
			tradeChartStack.scrollLeft = nativeScrollLeft;
			// The native rail is integral and the target is already clamped to the
			// spacer extent. Avoid reading scrollLeft after writing it: that read
			// synchronously flushes layout on every spring frame.
			const actualNativeScrollLeft = nativeScrollLeft;
			if (fixedPriceAxis) fixedPriceAxis.style.translate = `${actualNativeScrollLeft}px 0px`;
			if (probabilityHint) probabilityHint.style.translate = `${actualNativeScrollLeft}px 0px`;
			probabilityScrollVisualPosition = next;
			tradeChartStack.dataset.probabilityPanVisualPosition = String(
				probabilityScrollVisualPosition,
			);
			setProbabilityScrollVisualOffset(actualNativeScrollLeft - probabilityScrollVisualPosition);
			if (!isUpdatingProbabilityFieldPosition) {
				isUpdatingProbabilityFieldPosition = true;
				try {
					probabilityFieldPositionUpdater?.();
				} finally {
					isUpdatingProbabilityFieldPosition = false;
				}
			}
			if (
				!(probabilityScrollPort instanceof HTMLElement)
				|| probabilityScrollPort.hidden
				|| Math.abs(probabilityScrollPort.scrollLeft - actualNativeScrollLeft) <= 0.01
			) return;
			isSynchronizingProbabilityScrollPort = true;
			probabilityScrollPort.scrollLeft = actualNativeScrollLeft;
			isSynchronizingProbabilityScrollPort = false;
		};
		const completeProbabilityScroll = () => {
			probabilityScrollLastTimestamp = null;
			probabilityScrollCleanup = null;
			probabilityScrollVelocity = 0;
			if (probabilityScrollTarget <= 0.01) {
				setProbabilityScrollPosition(0);
				setProbabilityScrollPortActive(false);
				tradeChartStack.dataset.probabilityPanState = probabilityTooltip?.classList.contains("is-visible")
					? (pinState.mode === "pinned" ? "pinned-fit" : "tracking-fit")
					: "idle";
				if (probabilityScrollSpacer) {
					setInlineStyleIfChanged(probabilityScrollSpacer, "display", "none");
					probabilityScrollExtentDistance = 0;
				}
			} else {
				setProbabilityScrollPortActive(true);
				setProbabilityScrollExtent(probabilityScrollTarget);
				setProbabilityScrollPosition(probabilityScrollTarget);
				tradeChartStack.dataset.probabilityPanState = pinState.mode === "pinned"
					? "pinned-pan"
					: "tracking-pan";
			}
		};
		const setProbabilityScrollTarget = (targetValue, {immediate = false} = {}) => {
			if (!strategyPresentation) return;
			probabilityScrollTarget = Math.max(0, Number(targetValue) || 0);
			tradeChartStack.dataset.probabilityPanTarget = String(probabilityScrollTarget);
			tradeChartStack.dataset.probabilityPanMotion = "shared-pointer-follow";
			tradeChartStack.dataset.probabilityPanState = probabilityScrollTarget > 0
				? (pinState.mode === "pinned" ? "pinned-pan" : "tracking-pan")
				: (
					probabilityScrollVisualPosition > 0.01
						? "returning"
						: (pinState.mode === "pinned" ? "pinned-fit" : "tracking-fit")
				);
			probabilityScrollCleanup?.();
			probabilityScrollCleanup = null;
			probabilityScrollVelocity = 0;
			probabilityScrollLastTimestamp = null;
			if (probabilityScrollTarget > 0.01) {
				setProbabilityScrollPortActive(true);
				setProbabilityScrollExtent(probabilityScrollTarget);
				setProbabilityScrollPosition(probabilityScrollTarget);
				tradeChartStack.dataset.probabilityPanState = pinState.mode === "pinned"
					? "pinned-pan"
					: "tracking-pan";
				return;
			}
			if (probabilityScrollVisualPosition <= 0.01) {
				completeProbabilityScroll();
				return;
			}
			if (immediate) {
				completeProbabilityScroll();
				return;
			}
			setProbabilityScrollPortActive(true);
			setProbabilityScrollExtent(probabilityScrollVisualPosition);
			const scheduler = window.WorthwardMotion?.scheduler;
			if (!scheduler?.frame) {
				const frameId = window.requestAnimationFrame(() => completeProbabilityScroll());
				probabilityScrollCleanup = () => window.cancelAnimationFrame(frameId);
				return;
			}
		const preset = window.WorthwardMotion?.springPresets?.bouncy || {
				mass: 1,
				stiffness: 180,
				damping: 18,
			};
		probabilityScrollCleanup = scheduler.frame(
				"backtest-probability-scroll",
				(timestamp, reducedMotion) => {
					if (controllerDestroyed) return false;
					if (reducedMotion) {
						completeProbabilityScroll();
						return false;
					}
					if (probabilityScrollLastTimestamp === null) {
						probabilityScrollLastTimestamp = timestamp;
						return true;
					}
					const elapsedSeconds = Math.min(
						1 / 30,
						Math.max(1 / 240, (timestamp - probabilityScrollLastTimestamp) / 1000),
					);
					probabilityScrollLastTimestamp = timestamp;
					const current = probabilityScrollVisualPosition;
					const displacement = current - probabilityScrollTarget;
					const acceleration = (
						(-Number(preset.stiffness) * displacement)
						- (Number(preset.damping) * probabilityScrollVelocity)
					) / Math.max(0.001, Number(preset.mass) || 1);
					probabilityScrollVelocity += acceleration * elapsedSeconds;
					let next = current + (probabilityScrollVelocity * elapsedSeconds);
					const crossedTarget = (
						(current <= probabilityScrollTarget && next >= probabilityScrollTarget)
						|| (current >= probabilityScrollTarget && next <= probabilityScrollTarget)
					);
					if (crossedTarget) {
						next = probabilityScrollTarget;
						probabilityScrollVelocity = 0;
					}
					setProbabilityScrollExtent(Math.max(next, probabilityScrollTarget));
					setProbabilityScrollPosition(next);
					if (
						Math.abs(probabilityScrollVisualPosition - probabilityScrollTarget) <= 0.1
						&& Math.abs(probabilityScrollVelocity) <= 0.1
					) {
						completeProbabilityScroll();
						return false;
					}
					return true;
				},
			);
		};
		const snapProbabilityScrollToFit = () => {
			probabilityScrollCleanup?.();
			probabilityScrollCleanup = null;
			probabilityScrollTarget = 0;
			tradeChartStack.dataset.probabilityPanTarget = "0";
			probabilityScrollVelocity = 0;
			probabilityScrollLastTimestamp = null;
			completeProbabilityScroll();
		};
		if (probabilityScrollPort instanceof HTMLElement) {
			probabilityScrollPort.addEventListener("scroll", () => {
				if (controllerDestroyed || isSynchronizingProbabilityScrollPort) return;
				const nativeNext = Math.max(0, probabilityScrollPort.scrollLeft);
				if (probabilityScrollTarget <= 0.01) {
					probabilityScrollCleanup?.();
					probabilityScrollCleanup = null;
					probabilityScrollVelocity = 0;
					probabilityScrollLastTimestamp = null;
					setProbabilityScrollPosition(0);
					completeProbabilityScroll();
					return;
				}
				if (Math.abs(tradeChartStack.scrollLeft - nativeNext) <= 0.01) return;
				probabilityScrollCleanup?.();
				probabilityScrollCleanup = null;
				probabilityScrollVelocity = 0;
				probabilityScrollLastTimestamp = null;
				const visualNext = probabilityScrollTarget > 0
					? Math.min(nativeNext, probabilityScrollTarget)
					: nativeNext;
				setProbabilityScrollPosition(visualNext);
				if (!isProbabilityHoverPointerOverStack(tradeChartStack.getBoundingClientRect())) {
					updateCurveHoverLine();
				}
			}, {signal: documentController.signal});
		}

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
		const formatSelectedDate = (dateParts) => {
			if (typeof formatFullDateParts === "function") {
				return formatFullDateParts(dateParts, { includeTime: false });
			}
			const monthNames = [
				"Jan", "Feb", "Mar", "Apr", "May", "Jun",
				"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
			];
			return `${dateParts.day} ${monthNames[dateParts.monthIndex] || ""} ${dateParts.year}`.trim();
		};

		const formatChartDateLines = (dateParts) => {
			const displayDateParts = interval === "1d"
				? {
					year: dateParts.year,
					monthIndex: dateParts.monthIndex,
					day: dateParts.day,
				}
				: dateParts;
			return typeof formatFullDateLines === "function"
				? formatFullDateLines(displayDateParts, { allowWrap: true })
				: [`${displayDateParts.day}/${displayDateParts.monthIndex + 1}`, `${displayDateParts.year}`];
		};
		const hideHoverDateLabel = () => {
			hoverDateLabel.hidden = true;
			hoverDateLabel.classList.remove("is-visible");
		};
		const updateHoverDateLabel = (x, top, index) => {
			if (!strategyPresentation || !Number.isFinite(x) || !Number.isFinite(top)) {
				hideHoverDateLabel();
				return;
			}
			const dateParts = parseRawDate(rawDates[index]);
			if (!dateParts) {
				hideHoverDateLabel();
				return;
			}
			const [firstLine, secondLine] = formatChartDateLines(dateParts);
			const primaryLine = hoverDateLabel.querySelector(
				'[data-backtest-hover-date-line="primary"]',
			);
			const secondaryLine = hoverDateLabel.querySelector(
				'[data-backtest-hover-date-line="secondary"]',
			);
			if (primaryLine && primaryLine.textContent !== (firstLine || "")) primaryLine.textContent = firstLine || "";
			if (secondaryLine) {
				if (secondaryLine.textContent !== (secondLine || "")) secondaryLine.textContent = secondLine || "";
				secondaryLine.hidden = !secondLine;
			}
			hoverDateLabel.hidden = false;
			const halfWidth = (hoverDateLabel.offsetWidth || 42) / 2;
			const visualX = Math.max(halfWidth, Math.min(
				tradeChartStack.clientWidth - halfWidth, x - probabilityScrollVisualPosition,
			));
			hoverDateLabel.style.left = `${visualX + probabilityScrollVisualPosition}px`;
			hoverDateLabel.style.top = `${top}px`;
			hoverDateLabel.hidden = false;
			hoverDateLabel.classList.add("is-visible");
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


		const addTradingDays = (dateParts, tradingDays) => {
			if (!dateParts) return null;
			const cursor = new Date(Date.UTC(
				dateParts.year,
				dateParts.monthIndex,
				dateParts.day,
			));
			if (Number.isNaN(cursor.getTime())) return null;
			const direction = tradingDays < 0 ? -1 : 1;
			let remainingDays = Math.abs(Math.trunc(Number(tradingDays) || 0));
			while (remainingDays > 0) {
				cursor.setUTCDate(cursor.getUTCDate() + direction);
				const weekday = cursor.getUTCDay();
				if (weekday !== 0 && weekday !== 6) remainingDays -= 1;
			}
			return {
				year: cursor.getUTCFullYear(),
				monthIndex: cursor.getUTCMonth(),
				day: cursor.getUTCDate(),
				hours: null,
				minutes: null,
			};
		};

		const buildProbabilityTimelineDateParts = (targetIndex) => {
            const knownDate = parseRawDate(rawDates[targetIndex]);
            if (knownDate) return knownDate;
            const boundaryIndex = targetIndex < 0 ? 0 : rawDates.length - 1;
            return addTradingDays(parseRawDate(rawDates[boundaryIndex]), targetIndex - boundaryIndex);
        };
        const buildProbabilityForecastDateParts = (anchorIndex, horizon) => {
            return buildProbabilityTimelineDateParts(anchorIndex + Math.max(1, Math.floor(Number(horizon) || 0)));
        };

		const applyProbabilityCellNode = (
			node,
			cell,
			modifierClass = "",
			includeGridPlacement = true,
		) => {
			const thresholdVisible = cell.isVisible !== false;
			node.className = `backtest-probability-cell is-${cell.sign}${modifierClass ? ` ${modifierClass}` : ""}`
				+ (thresholdVisible ? "" : " is-threshold-hidden");
			node.dataset.column = String(cell.column);
			node.dataset.horizon = String(cell.horizon);
			node.dataset.probability = String(cell.probability);
			node.dataset.displayIntensity = String(cell.displayIntensity);
			node.dataset.opacity = String(cell.opacity);
			node.dataset.row = String(cell.row);
			node.dataset.lowerPrice = String(cell.lowerPrice);
			node.dataset.upperPrice = String(cell.upperPrice);
			node.dataset.thresholdVisible = String(thresholdVisible);
			if (includeGridPlacement) {
				node.style.gridColumn = String(cell.column + 1);
				node.style.gridRow = String(cell.row + 1);
			}
			node.style.opacity = thresholdVisible ? String(cell.opacity) : "0";
			if (thresholdVisible) node.removeAttribute("aria-hidden");
			else node.setAttribute("aria-hidden", "true");
			node.title = `${(cell.probability * 100).toFixed(2)}%`;
		};
		const probabilityCanvasContext = probabilityCanvas?.getContext?.("2d") || null;
		const drawProbabilityCanvas = (geometry, cells) => {
			if (!(probabilityCanvas instanceof HTMLCanvasElement) || !probabilityCanvasContext) return;
			const width = Math.max(1, Number(geometry?.width) || 0);
			const height = Math.max(1, Number(geometry?.height) || 0);
			const deviceScale = Math.max(
				1,
				Math.min(2, Number(window.devicePixelRatio) || 1),
			);
			const bitmapWidth = Math.ceil(width * deviceScale);
			const bitmapHeight = Math.ceil(height * deviceScale);
			if (probabilityCanvas.width !== bitmapWidth) probabilityCanvas.width = bitmapWidth;
			if (probabilityCanvas.height !== bitmapHeight) probabilityCanvas.height = bitmapHeight;
			setInlineStyleIfChanged(probabilityCanvas, "width", `${width}px`);
			setInlineStyleIfChanged(probabilityCanvas, "height", `${height}px`);
			probabilityCanvasContext.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
			probabilityCanvasContext.clearRect(0, 0, width, height);
			let fillStyle = null;
			cells.forEach((cell) => {
				if (cell.isVisible === false || !(Number(cell.opacity) > 0)) return;
				const nextFillStyle = cell.sign === "down"
					? resolvedTheme.accentSecondary
					: resolvedTheme.accentPositive;
				if (fillStyle !== nextFillStyle) {
					fillStyle = nextFillStyle;
					probabilityCanvasContext.fillStyle = fillStyle;
				}
				probabilityCanvasContext.globalAlpha = Number(cell.opacity) || 0;
				probabilityCanvasContext.fillRect(
					Number(cell.x) - Number(geometry.left),
					Number(cell.y) - Number(geometry.top),
					Number(cell.size) || Number(geometry.cellSize),
					Number(cell.size) || Number(geometry.cellSize),
				);
			});
			probabilityCanvasContext.globalAlpha = 1;
		};

		const renderProbabilityDetail = (index, model) => {
			if (!(probabilityDetailPanel instanceof HTMLElement)
				|| !(probabilityDetailGrid instanceof HTMLElement)
				|| !(probabilityDetailYAxis instanceof HTMLElement)
				|| !(probabilityDetailXAxis instanceof HTMLElement)
				|| !model?.geometry) return false;

            latestProbabilityDetailIndex = index;
            const detailViewActive = isProbabilityHistoryViewActive();
            probabilityDetailPanel.hidden = !detailViewActive;
			probabilityDetailPanel.setAttribute("aria-hidden", String(!detailViewActive));
			probabilityDetailPanel.dataset.activeIndex = String(index);
            if (!detailViewActive) return false;
			if (!window.WORTHWARD_PRICE_FIELD_DETAIL_CHART) {
				if (!detailModulePending && !detailModuleFailed) {
					detailModulePending = true;
					loadDetailModule().then(() => {
						if (!controllerDestroyed) scheduleProbabilityDetailRefresh();
					}).catch(() => {
						detailModuleFailed = true;
						if (!controllerDestroyed && probabilityDetailStatus) {
							probabilityDetailStatus.textContent = "Price field detail could not be loaded. Reload to retry.";
						}
					}).finally(() => { detailModulePending = false; });
				}
				return false;
			}
			const detailModel = buildProbabilityDetailModel(index, model);
			if (!detailModel) return false;
			const {geometry, cells, anchorPrice} = detailModel;
			latestProbabilityDetailModel = detailModel;
			renderProbabilityDetailSideSummary(cells);
			const anchorDate = parseRawDate(rawDates[index]);
			const selectedDate = anchorDate ? formatSelectedDate(anchorDate) : (labels[index] || "selected date");
			latestProbabilityDetailBaseStatus = `Selected date: ${selectedDate}`;
			if (strategyPresentation?.training_label) {
				const trainingLabel = String(strategyPresentation.training_label);
				const device = strategyPresentation.device || {};
				const originsTrained = Number(device.origins_trained);
				const trainMs = Number(device.train_ms);
				const resolvedBackend = String(device.resolved || "cpu").toUpperCase();
				if (originsTrained > 0 && trainMs > 0) {
					const originLabel = originsTrained.toLocaleString("en-US");
					const durationLabel = trainMs.toLocaleString("en-US", {
						maximumFractionDigits: 0,
					});
					latestProbabilityDetailBaseStatus += (
						` · ${trainingLabel}: ${originLabel} causal origins · `
						+ `backend: ${resolvedBackend} · ${durationLabel} ms`
					);
				} else {
					latestProbabilityDetailBaseStatus += ` · ${trainingLabel}: no completed origins`;
				}
			}
			const detailGridViewport = probabilityDetailGrid.parentElement;
			if (detailGridViewport) {
				let emptyState = detailGridViewport.querySelector(".backtest-probability-empty-state");
				if (!emptyState) {
					emptyState = document.createElement("div");
					emptyState.className = "backtest-probability-empty-state";
					detailGridViewport.appendChild(emptyState);
				}
				const empty = cells.every((cell) => cell.isVisible === false);
				const copy = empty ? `All cells below ${Number(detailModel.cellDisplayThresholdPct).toFixed(2)}% · max ${(Math.max(...cells.map((cell) => cell.probability)) * 100).toFixed(2)}%` : "";
				if (emptyState.textContent !== copy) emptyState.textContent = copy;
				emptyState.hidden = !empty;
			}
            // Geometry depends on the container, never on hover values or label widths.
            const detailPlot = probabilityDetailYAxis.closest("[data-backtest-probability-detail-plot]");
            if (detailPlot) {
                const axisWidth = readPxToken(tradeChartStack, "--backtest-chart-y-axis-width", 72) - 28;
                const availableWidth = probabilityDetailPanel.clientWidth - 4;
                const availableHeight = Math.max(0, detailPlot.clientHeight - probabilityDetailXAxis.offsetHeight);
                const plotWidth = Math.min(availableWidth,
                    axisWidth + Math.max(0, availableHeight - 4) * geometry.columnCount / 10 + 4);
                detailPlot.style.gridTemplateColumns = `${axisWidth}px minmax(0, 1fr)`;
                detailPlot.style.width = `${plotWidth}px`;
                detailPlot.style.alignSelf = "center";
            }
			const detailGridViewportRect = detailGridViewport?.getBoundingClientRect();
			const detailGridViewportWidth = Number.isFinite(Number(detailGridViewportRect?.width))
				? Math.max(0, Number(detailGridViewportRect.width))
				: 0;
            const detailGridViewportHeight = Number.isFinite(Number(detailGridViewportRect?.height))
                ? Math.max(0, Number(detailGridViewportRect.height))
                : 0;
            const detailViewportReady = detailGridViewportWidth > 0
                && detailGridViewportHeight > 0;
            const renderKey = [
                detailModel.cacheKey || [
                    index,
					geometry.anchorX,
					geometry.anchorY,
					geometry.cellSize,
					geometry.rowCount,
				].join("|"),
                detailGridViewportWidth,
                detailGridViewportHeight,
            ].join("|");
            const modelHiddenCount = cells.filter((cell) => cell.isVisible === false).length;
            const detailHiddenCount = Array.from(
                probabilityDetailGrid.children,
            ).filter((cell) => cell.dataset.thresholdVisible === "false").length;
            const detailPresentationChanged = (
                probabilityDetailPanel.dataset.cellDisplayThresholdPct
                    !== String(detailModel.cellDisplayThresholdPct)
                || Number(probabilityDetailPanel.dataset.thresholdHiddenCount)
                    !== modelHiddenCount
                || probabilityDetailGrid.childElementCount !== cells.length
                || detailHiddenCount !== modelHiddenCount
            );
			if (
				probabilityDetailPanel.dataset.renderKey === renderKey
				&& !detailPresentationChanged
				&& detailViewportReady
			) {
				if (Number.isInteger(activeProbabilityDetailRow)) {
					renderProbabilityDetailRowHover(activeProbabilityDetailRow);
				}
				return true;
			}
			probabilityDetailPanel.dataset.columnCount = String(geometry.columnCount);
			probabilityDetailPanel.dataset.rowCount = String(geometry.rowCount);
			probabilityDetailPanel.dataset.daysPerColumn = String(geometry.daysPerColumn);
			probabilityDetailPanel.dataset.cellDisplayThresholdPct = String(
				detailModel.cellDisplayThresholdPct,
			);
			probabilityDetailPanel.dataset.thresholdHiddenCount = String(
				cells.filter((cell) => cell.isVisible === false).length,
			);
			probabilityDetailGrid.setAttribute(
				"aria-label",
				`Future price probability field for ${labels[index] || "selected date"}; displayed from the signal-close anchor; executable target is next-open to-following-open`,
			);
			if (probabilityDetailStatus instanceof HTMLElement) {
				probabilityDetailStatus.textContent = latestProbabilityDetailBaseStatus;
			}
			if (probabilityDetailAnchor instanceof HTMLElement) {
				probabilityDetailAnchor.dataset.price = String(anchorPrice);
			}

			const canReuseCells = probabilityDetailGrid.childElementCount === cells.length
				&& Number(probabilityDetailGrid.dataset.columnCount) === geometry.columnCount
				&& Number(probabilityDetailGrid.dataset.rowCount) === geometry.rowCount;
			let cellNodes = canReuseCells ? Array.from(probabilityDetailGrid.children) : [];
			if (!canReuseCells) {
				const fragment = document.createDocumentFragment();
				cellNodes = cells.map(() => {
					const node = document.createElement("span");
					fragment.appendChild(node);
					return node;
				});
				probabilityDetailGrid.replaceChildren(fragment);
			}
			cells.forEach((cell, cellIndex) => applyProbabilityCellNode(
				cellNodes[cellIndex],
				cell,
				"backtest-probability-detail-cell",
			));
			if (Number.isInteger(activeProbabilityDetailRow)) {
				renderProbabilityDetailRowHover(activeProbabilityDetailRow);
			}
            probabilityDetailGrid.dataset.columnCount = String(geometry.columnCount);
            probabilityDetailGrid.dataset.daysPerColumn = String(geometry.daysPerColumn);
            probabilityDetailGrid.dataset.rowCount = String(geometry.rowCount);
            if (!detailViewportReady) return false;
			const finalHorizon = Math.max(...cells.map((cell) => cell.horizon));
			const historyStart = Math.max(0, index - finalHorizon);
			const history = close.slice(historyStart, index + 1);
			const layout = window.WORTHWARD_PRICE_FIELD_DETAIL_CHART.computeLayout({
				width: detailGridViewportWidth, height: detailGridViewportHeight,
				anchorPrice, history, horizon: finalHorizon, lowerPrice: Math.min(...cells.map((cell) => cell.lowerPrice)),
				upperPrice: Math.max(...cells.map((cell) => cell.upperPrice)),
				rowsAbove: geometry.rowsAbove, rowsBelow: geometry.rowsBelow,
				columns: geometry.columnCount, gap: geometry.gap,
			});
			if (!layout) return false;
			const detailLayoutKey = renderKey;
			Object.assign(probabilityDetailGrid.style, {
				left: `${layout.gridLeft}px`, top: `${layout.gridTop}px`,
				width: `${layout.gridWidth}px`, height: `${layout.gridHeight}px`,
				gridTemplateColumns: `repeat(${geometry.columnCount}, ${layout.cellWidth}px)`,
				gridTemplateRows: `repeat(${geometry.rowCount}, ${layout.cellHeight}px)`,
				columnGap: `${layout.columnGap}px`, rowGap: `${layout.rowGap}px`, padding: "0", transform: "none",
			});
			let historySvg = probabilityDetailPanel.querySelector("[data-backtest-probability-detail-history]");
			if (!historySvg) {
				historySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				historySvg.classList.add("backtest-probability-detail-history");
				historySvg.dataset.backtestProbabilityDetailHistory = "";
				historySvg.setAttribute("role", "img");
				historySvg.setAttribute("aria-label", "Historical prices through the selected date");
				const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
				path.dataset.backtestProbabilityDetailHistoryPath = "";
				historySvg.appendChild(path);
				detailGridViewport.prepend(historySvg);
			}
			if (!detailGridViewport.querySelector("[data-backtest-probability-detail-origin]")) {
				const origin = document.createElement("span");
				origin.className = "backtest-probability-detail-origin";
				origin.dataset.backtestProbabilityDetailOrigin = "";
				origin.setAttribute("aria-hidden", "true");
				detailGridViewport.appendChild(origin);
			}
			const historyPath = historySvg?.querySelector("path");
			if (historySvg && historyPath) {
				historySvg.setAttribute("viewBox", `0 0 ${detailGridViewportWidth} ${detailGridViewportHeight}`);
				historySvg.dataset.pointCount = String(history.length);
				historySvg.dataset.startDate = rawDates[historyStart] || "";
				historySvg.dataset.startIndex = String(historyStart);
				historySvg.dataset.endDate = rawDates[index] || "";
				let connected = false;
				const commands = history.map((price, pointIndex) => {
					if (typeof price !== "number" || !Number.isFinite(price)) { connected = false; return ""; }
					const command = `${connected ? "L" : "M"}${layout.historyX(pointIndex)},${layout.priceToY(price)}`;
					connected = true;
					return command;
				});
				historyPath.setAttribute("d", commands.join(" "));
			}
			probabilityDetailYAxis.replaceChildren();
			for (let tickIndex = 0; tickIndex < 5; tickIndex += 1) {
				const tick = document.createElement("span");
				const price = layout.maxPrice - (layout.maxPrice - layout.minPrice) * tickIndex / 4;
				tick.className = "backtest-probability-detail-y-tick";
				tick.dataset.backtestProbabilityDetailYTick = "";
				tick.dataset.price = String(price);
				tick.style.top = `${tickIndex * 25}%`;
				tick.textContent = formatStockPriceAxisValue(price);
				probabilityDetailYAxis.appendChild(tick);
			}

			const dateKey = (parts) => parts ? `${parts.year}-${String(parts.monthIndex + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : "";
			const ticks = [
				{key: "start", x: layout.historyLeft, parts: buildProbabilityTimelineDateParts(index - finalHorizon), source: index >= finalHorizon ? "observed" : "projected", priority: 0},
				{key: "origin", x: layout.anchorX, parts: anchorDate, source: "observed", priority: 0},
				{key: "end", x: layout.forecastRight, parts: buildProbabilityForecastDateParts(index, finalHorizon),
					horizon: finalHorizon, source: rawDates[index + finalHorizon] ? "observed" : "projected", priority: 0},
			];
			for (const fraction of [0.5, 0.25, 0.75]) {
                const offset = Math.round(finalHorizon * fraction);
                ticks.push({key: `history-${offset}`, x: layout.anchorX - layout.pitch * geometry.columnCount * offset / finalHorizon,
                    parts: buildProbabilityTimelineDateParts(index - offset), source: index >= offset ? "observed" : "projected",
                    priority: fraction === 0.5 ? 1 : 2});
            }
			new Set([0.5, 0.25, 0.75].map((fraction) => Math.max(0, Math.round(geometry.columnCount * fraction) - 1))).forEach((column) => {
				const cell = cells.find((candidate) => candidate.column === column);
				if (cell && cell.horizon < finalHorizon) ticks.push({key: `forecast-${column}`,
					x: layout.anchorX + layout.pitch * (column + 1), parts: buildProbabilityForecastDateParts(index, cell.horizon),
					horizon: cell.horizon, source: rawDates[index + cell.horizon] ? "observed" : "projected",
					priority: column === Math.round(geometry.columnCount / 2) - 1 ? 1 : 2});
			});
			probabilityDetailXAxisTickNodes.clear();
			probabilityDetailXAxis.replaceChildren();
			const accepted = [];
			for (const item of ticks.sort((left, right) => left.priority - right.priority || left.x - right.x)) {
				if (!item.parts) continue;
				const tick = document.createElement("span");
				tick.className = "backtest-probability-detail-x-tick";
				tick.classList.toggle("is-first", item.key === "start");
				tick.classList.toggle("is-last", item.key === "end");
				tick.dataset.backtestProbabilityDetailXTick = "";
				tick.dataset.timelineRole = item.key;
				tick.dataset.rawDate = dateKey(item.parts);
				tick.dataset.dateSource = item.source;
				if (item.horizon) tick.dataset.horizon = String(item.horizon);
				tick.style.left = `${item.x}px`;
				tick.title = item.source === "projected"
					? "Estimated date; weekdays only, exchange holidays may shift the forecast interval."
					: formatSelectedDate(item.parts);
				const lines = formatChartDateLines(item.parts);
				lines.forEach((text) => {
					if (!text) return;
					const line = document.createElement("span");
					line.className = "backtest-probability-detail-x-tick-line";
					line.textContent = text;
					tick.appendChild(line);
				});
				probabilityDetailXAxis.appendChild(tick);
				const rect = tick.getBoundingClientRect();
				const overlaps = accepted.some((other) => rect.left < other.right + 8 && rect.right > other.left - 8);
				if (item.priority > 0 && overlaps) tick.remove();
				else accepted.push(rect);
			}

			Array.from(probabilityDetailXAxis.children)
				.sort((left, right) => Number.parseFloat(left.style.left) - Number.parseFloat(right.style.left))
				.forEach((tick) => probabilityDetailXAxis.appendChild(tick));

			probabilityDetailPanel.dataset.layoutKey = detailLayoutKey;
			probabilityDetailPanel.dataset.renderKey = renderKey;
			return true;
		};

		const xAxisLabelPlugin = {
			id: "tradeXAxisLabelPlugin",
			afterDraw(chart) {
				const xAxisCanvas = isBacktestTradeDetailsEnabled() ? equityCanvas : priceCanvas;
				if (chart.canvas !== xAxisCanvas) return;
				const { ctx, chartArea, scales } = chart;
				const xScale = scales?.x;
				if (!chartArea || !xScale || !labels.length) return;
				const viewportWidth = tradeChartStack?.clientWidth || chart.canvas?.clientWidth || window.innerWidth || document.documentElement.clientWidth || 0;
				const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
				const baselineY = chartArea.bottom;
				const lineHeight = chartAxisLineHeight;
				ctx.save();
				ctx.fillStyle = resolvedTheme.muted;
				ctx.font = chartAxisCanvasFont;
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
					if (strategyPresentation && activePriceOverlay && !hoverDateLabel.hidden) {
						const width = Math.max(ctx.measureText(firstLine).width, ctx.measureText(secondLine).width);
						const left = x - (ctx.textAlign === "right" ? width : ctx.textAlign === "center" ? width / 2 : 0);
						const badgeX = Number.parseFloat(hoverDateLabel.style.left) - getStaticStackContentLeft(chart.canvas);
						const halfBadge = hoverDateLabel.offsetWidth / 2;
						if (left < badgeX + halfBadge && left + width > badgeX - halfBadge) return;
					}
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
				if (!isBacktestTradeDetailsEnabled() || chart.canvas !== priceCanvas) return;
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
				const {ctx, chartArea, scales} = chart;
				const yScale = scales?.y;
				if (!point || !chartArea || !yScale || !Number.isFinite(point.y)) return;
				let guideX = point.x;
				let guideY = point.y;
				let price = Number(close[activeIndex]);
				let contentX = null;
				if (
					strategyPresentation
					&& pinState.mode !== "pinned"
					&& isProbabilityHoverPointerOverStack(tradeChartStack.getBoundingClientRect())
				) {
					const guide = getProbabilityHoverGuide(tradeChartStack.getBoundingClientRect());
					const canvasRect = chart.canvas.getBoundingClientRect();
					const canvasContentLeft = getPriceCanvasContentLeft();
					const scaleX = canvasRect.width / Number(chart.width);
					if (
						guide
						&& Number.isFinite(guide.contentX)
						&& Number.isFinite(guide.intersection?.y)
						&& Number.isFinite(canvasContentLeft)
						&& scaleX > 0
					) {
						guideX = (guide.contentX - canvasContentLeft) / scaleX;
						guideY = guide.intersection.y;
						contentX = guide.contentX;
						const interpolatedPrice = yScale.getValueForPixel(guideY);
						if (Number.isFinite(interpolatedPrice)) price = interpolatedPrice;
					}
				}
				if (!Number.isFinite(guideX) || !Number.isFinite(guideY) || !Number.isFinite(price)) return;
				chart._activeBacktestPriceGuideBounds = {
					index: activeIndex,
					left: chartArea.left,
					price,
					right: chartArea.right,
					x: guideX,
					y: guideY,
					...(Number.isFinite(contentX) ? {contentX} : {}),
				};
				if (strategyPresentation) return;
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
			},
			afterDatasetsDraw(chart) {
				if (strategyPresentation) return;
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
			afterDraw(chart) {
				if (!fixedPriceAxis || chart.canvas !== priceCanvas || !chart.chartArea) return;
				const ratio = chart.currentDevicePixelRatio || 1;
				const width = Math.ceil(chart.chartArea.left + 48);
				const height = chart.height;
				if (fixedPriceAxis.width !== Math.ceil(width * ratio)) fixedPriceAxis.width = Math.ceil(width * ratio);
				if (fixedPriceAxis.height !== Math.ceil(height * ratio)) fixedPriceAxis.height = Math.ceil(height * ratio);
				setInlineStyleIfChanged(fixedPriceAxis, "width", `${width}px`);
				setInlineStyleIfChanged(fixedPriceAxis, "height", `${height}px`);
				setInlineStyleIfChanged(fixedPriceAxis, "top", `${priceCanvas.offsetTop}px`);
				const ctx = fixedPriceAxis.getContext("2d");
				ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
				ctx.clearRect(0, 0, width, height);
				// Composite the actual translucent surface over its ancestors. Using
				// only the body color creates a visibly different strip in dark mode.
				ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--theme-background").trim() || "#ffffff";
				ctx.fillRect(0, 0, chart.chartArea.left, height);
				const backgrounds = [];
				for (let node = priceCanvas.parentElement; node; node = node.parentElement) {
					backgrounds.push(getComputedStyle(node).backgroundColor);
				}
				backgrounds.reverse().forEach((color) => {
					ctx.fillStyle = color;
					ctx.fillRect(0, 0, chart.chartArea.left, height);
				});
				ctx.drawImage(chart.canvas, 0, 0, chart.chartArea.left * ratio, height * ratio,
					0, 0, chart.chartArea.left, height);
				const bounds = chart._activeBacktestPriceGuideBounds;
				if (bounds) {
					const badge = chartAxis.drawYAxisValueBadge?.({...chart, ctx}, {
						y: bounds.y, value: bounds.price, formattedValue: formatMoney(bounds.price),
						formatTickLabel: formatStockPriceAxisValue, fillColor: resolvedTheme.accentPrimary,
					});
					if (badge) Object.assign(bounds, badge, {formattedPrice: formatMoney(bounds.price)});
				}
			},
		};

		const buildYAxisTicks = (fractionDigits, valueFormatter = null) => ({
				color: resolvedTheme.muted,
				font: {
					family: chartAxisFontFamily,
					size: chartAxisFontSize,
					weight: chartAxisFontWeight,
				},
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
			if (!priceChart?.chartArea) return null;
			const showTradeDetails = isBacktestTradeDetailsEnabled();
			if (showTradeDetails && !equityChart?.chartArea) return null;
			const priceCanvasRect = priceCanvas.getBoundingClientRect();
			const stackRect = tradeChartStack.getBoundingClientRect();
			const top = priceCanvasRect.top - stackRect.top + priceChart.chartArea.top;
			const bottomCanvas = showTradeDetails ? equityCanvas : priceCanvas;
			const bottomChart = showTradeDetails ? equityChart : priceChart;
			const bottomCanvasRect = bottomCanvas.getBoundingClientRect();
			const bottom = bottomCanvasRect.top - stackRect.top + bottomChart.chartArea.bottom;
			return { top, bottom };
		};

		const getDatasetPoint = (chart, index, datasetIndex = 0) => {
			const point = chart?.getDatasetMeta?.(datasetIndex)?.data?.[index];
			return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
		};

		const getStaticStackContentLeft = (element) => {
			if (!(element instanceof HTMLElement)) return null;
			let contentLeft = 0;
			let current = element;
			while (current instanceof HTMLElement && current !== tradeChartStack) {
				contentLeft += Number(current.offsetLeft) || 0;
				current = current.offsetParent;
			}
			return current === tradeChartStack && Number.isFinite(contentLeft)
				? contentLeft
				: null;
		};
		const getPriceCanvasContentLeft = () => getStaticStackContentLeft(priceCanvas);
		const getRelativePointPosition = (canvas, stackRect, point) => {
			if (!canvas || !point) return null;
			const contentLeft = getStaticStackContentLeft(canvas);
			if (!Number.isFinite(contentLeft)) return null;
			const canvasRect = canvas.getBoundingClientRect();
			return {
				x: contentLeft + point.x,
				y: canvasRect.top - stackRect.top + point.y,
			};
		};

		const TRADE_MARKER_SNAP_HORIZONTAL_BARS = 3;
		const TRADE_MARKER_SNAP_HORIZONTAL_PX = 20;
		const TRADE_MARKER_SNAP_VERTICAL_PX = 20;
		const PROBABILITY_HOVER_EDGE_HANDOFF_PX = 2;

		const resolveProbabilityPointerIntersection = (stackRelativeX, stackRect) => {
			if (!priceChart?.width || !priceChart?.height) return null;
			const pointCache = getChartHoverPointCache(priceChart);
			const finitePoints = pointCache.finitePoints;
			if (!finitePoints.length) return null;
			const canvasRect = priceCanvas.getBoundingClientRect();
			const currentStackRect = stackRect || tradeChartStack.getBoundingClientRect();
			const scaleX = canvasRect.width / Number(priceChart.width);
			const scaleY = canvasRect.height / Number(priceChart.height);
			if (!(scaleX > 0) || !(scaleY > 0)) return null;
			// Recover unscrolled content origin from the live canvas rect so the
			// selected date matches the visible curve point, including after pan.
			const canvasContentLeft = (canvasRect.left - currentStackRect.left)
				+ probabilityScrollVisualPosition;
			if (!Number.isFinite(canvasContentLeft)) return null;
			const firstPoint = finitePoints[0];
			const lastPoint = finitePoints[finitePoints.length - 1];
			const firstContentX = canvasContentLeft + (firstPoint.x * scaleX);
			const lastContentX = canvasContentLeft + (lastPoint.x * scaleX);
			// Intersect the visible, already-panned curve directly below the cursor.
			const pointerContentX = Number(stackRelativeX) + probabilityScrollVisualPosition;
			if (!Number.isFinite(pointerContentX)) return null;
			const contentX = Math.min(
				lastContentX,
				Math.max(firstContentX, pointerContentX),
			);
			const clampedChartX = (contentX - canvasContentLeft) / scaleX;
			const intersection = probabilityGridApi.intersectPolylineAtX?.(
				finitePoints,
				clampedChartX,
			);
			if (!intersection || !Number.isInteger(intersection.index)) return null;
			return {
				canvasRect,
				contentX,
				intersection,
				lastContentX,
				scaleX,
				scaleY,
			};
		};

		const resolveNearestHoverIndex = (chart, event) => {
			const chartArea = chart?.chartArea;
			if (!chartArea || !labels.length) return null;
			const canvasRect = chart.canvas.getBoundingClientRect();
			const isProbabilityPriceHover = chart.canvas === priceCanvas && strategyPresentation;
			const interactionRect = isProbabilityPriceHover
				? tradeChartStack.getBoundingClientRect()
				: canvasRect;
			const relativeX = event.clientX - interactionRect.left;
			if (isProbabilityPriceHover) {
				probabilityHoverPointerX = Number(event.clientX);
				probabilityHoverPointerY = Number(event.clientY);
				probabilityHoverPointerActive = true;
			}
			const relativeY = event.clientY - canvasRect.top;
			if (!Number.isFinite(relativeX)) return null;
			const pointCache = getChartHoverPointCache(chart);
			const {points, finitePoints} = pointCache;
			if (!finitePoints.length) return null;
			let hoverRelativeX = relativeX;
			if (isProbabilityPriceHover) {
				// Include the current overflow pan so the selected origin is the
				// visible curve point under the vertical guide, not a lagged
				// date from unscrolled content space.
				const resolved = resolveProbabilityPointerIntersection(relativeX, interactionRect);
				if (!resolved) {
					resetProbabilityHoverPointer();
					return null;
				}
				probabilityHoverIntersection = resolved.intersection;
				return resolved.intersection.index;
			}
			let low = 0;
			let high = finitePoints.length - 1;
			while (low < high) {
				const midpoint = Math.floor((low + high) / 2);
				if (finitePoints[midpoint].x < hoverRelativeX) low = midpoint + 1;
				else high = midpoint;
			}
			const rightPoint = finitePoints[low];
			const leftPoint = finitePoints[Math.max(0, low - 1)];
			const nearestPoint = Math.abs(leftPoint.x - hoverRelativeX)
				<= Math.abs(rightPoint.x - hoverRelativeX)
				? leftPoint
				: rightPoint;
			const nearestIndex = nearestPoint.index;

			if (!Number.isInteger(nearestIndex)) return null;
			if (chart.canvas !== priceCanvas || !Number.isFinite(relativeY)) return nearestIndex;
			if (relativeY < chartArea.top || relativeY >= chartArea.bottom) return nearestIndex;
			if (strategyPresentation) return nearestIndex;

			const yScale = chart.scales?.y;
			if (!yScale) return nearestIndex;

			const markerCandidates = isBacktestTradeDetailsEnabled()
				? [...tradeMarkerPoints.buy, ...tradeMarkerPoints.sell]
				: [];
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

		const hideProbabilityTooltip = ({immediate = false} = {}) => {
			if (probabilityHint) probabilityHint.hidden = true;
			tradeChartStack.classList.remove("has-probability-overflow");
			resetProbabilityHoverPointer();
			hideHoverDateLabel();
			probabilityTooltip?.classList.remove("is-visible");
			if (probabilityTooltip) {
				probabilityTooltip.hidden = true;
				probabilityTooltip.dataset.pinned = pinState.mode === "pinned" ? "true" : "false";
			}
			if (priceChart) priceChart._activeBacktestProbabilityGridBounds = null;
			if (immediate) snapProbabilityScrollToFit();
			else setProbabilityScrollTarget(0);
		};

		const buildProbabilityGridModel = (index, pricePoint) => {
			if (!strategyPresentation || !priceChart?.chartArea || !priceChart?.scales?.y || !pricePoint) {
				return null;
			}
			const hoverLayout = getProbabilityHoverLayout();
			if (!hoverLayout) return null;
			const cachedModel = probabilityModelCache.get(index);
			if (cachedModel?.cacheKey?.startsWith(`${hoverLayout.signature}|${index}`)) {
				probabilityModelCache.delete(index);
				probabilityModelCache.set(index, cachedModel);
				return cachedModel;
			}
			const meanValue = strategyPresentation.predictive_mean?.[index];
			const scaleValue = strategyPresentation.predictive_scale?.[index];
			const autoregressionValue = strategyPresentation.return_autoregression?.[index];
			const longRunMeanValue = strategyPresentation.return_long_run_mean?.[index];
			const innovationScaleValue = strategyPresentation.return_innovation_scale?.[index];
			const mean = Number(meanValue);
			const scale = Number(scaleValue);
			const autoregression = Number(autoregressionValue);
			const longRunMean = Number(longRunMeanValue);
			const innovationScale = Number(innovationScaleValue);
			const anchorPrice = Number(close[index]);
			if (meanValue === null || meanValue === undefined
				|| scaleValue === null || scaleValue === undefined
				|| autoregressionValue === null || autoregressionValue === undefined
				|| longRunMeanValue === null || longRunMeanValue === undefined
				|| innovationScaleValue === null || innovationScaleValue === undefined
				|| !Number.isFinite(mean) || !Number.isFinite(scale) || !(scale > 0)
				|| !Number.isFinite(autoregression) || !Number.isFinite(longRunMean)
				|| !Number.isFinite(innovationScale) || !(innovationScale > 0)
				|| !(anchorPrice > 0)) {
				return null;
			}
			const {cellSizeTargetPx, stepPixels} = hoverLayout;
			const geometry = probabilityGridApi.computeGridGeometry?.({
				chartArea: priceChart.chartArea,
				anchorX: pricePoint.x,
				anchorY: pricePoint.y,
				columnCount: strategyPresentation.columns,
				widthFraction: strategyPresentation.width_fraction,
				gapPx: strategyPresentation.gap_px,
				paddingPx: strategyPresentation.padding_px,
				minCellPx: strategyPresentation.min_cell_px,
				rowsAbove: strategyPresentation.rows_above,
				rowsBelow: strategyPresentation.rows_below,
				stepPixels,
				cellSizeTargetPx,
			});
			if (!geometry) return null;
			const cells = probabilityGridApi.buildProbabilityCells?.({
				distribution,
				geometry,
				anchorPrice,
				mean,
				scale,
				autoregression,
				longRunMean,
				innovationScale,
				stepPixels,
				valueForPixel: (pixel) => priceChart.scales.y.getValueForPixel(pixel),
				opacityExponent: strategyPresentation.cell_opacity_exponent,
				opacityTailRatio: strategyPresentation.cell_opacity_tail_ratio,
				cellDisplayThresholdPct: strategyPresentation.cell_display_threshold_pct,
			}) || [];
			if (!cells.length) return null;
			const model = {
				anchorPrice,
				cells,
				cacheKey: `${hoverLayout.signature}|${index}`,
				geometry,
				mean,
				scale,
				autoregression,
				longRunMean,
				innovationScale,
				stepPixels,
				cellDisplayThresholdPct: strategyPresentation.cell_display_threshold_pct,
			};
			probabilityModelCache.set(index, model);
			while (probabilityModelCache.size > PROBABILITY_MODEL_CACHE_LIMIT) {
				probabilityModelCache.delete(probabilityModelCache.keys().next().value);
			}
			return model;
		};
		const buildProbabilityHoverModel = (index, model, pricePoint) => {
			if (!model?.geometry || !pricePoint || !priceChart?.scales?.y) return model;
			const intersection = pinState.mode !== "pinned" ? probabilityHoverIntersection : null;
			const anchorY = Number.isFinite(intersection?.y)
				? Number(intersection.y)
				: Number(pricePoint.y);
			if (!Number.isFinite(anchorY)
				|| Math.abs(anchorY - Number(model.geometry.anchorY)) <= 1e-9) return model;
			// Keep the model values and row classification tied to the selected
			// signal-close anchor. Only translate the already-quantized lattice to
			// the live guide Y, so the floating field can align with the line without
			// creating a second probability dataset that disagrees with the detail.
			const verticalOffset = anchorY - Number(model.geometry.anchorY);
			const hoverGeometry = {
				...model.geometry,
				anchorY,
				top: Number(model.geometry.top) + verticalOffset,
			};
			const cells = model.cells.map((cell) => ({
				...cell,
				y: Number(cell.y) + verticalOffset,
				yBottom: Number(cell.yBottom) + verticalOffset,
				symmetryOffset: (
					(Number(cell.y) + verticalOffset + (Number(cell.size) / 2)) - anchorY
				),
			}));
			return {
				...model,
				cacheKey: `${model.cacheKey}|hover|${anchorY}`,
				cells,
				geometry: hoverGeometry,
			};
		};

		// The hover field is deliberately clipped to Chart.js' plot area. The
		// history detail is an independent presentation surface, so it keeps the
		// strategy-owned row lattice even when the selected curve point is near a
		// chart edge.
		const buildProbabilityDetailModel = (index, model) => {
			if (!strategyPresentation || !model?.geometry || !priceChart?.chartArea
				|| !priceChart?.scales?.y) return null;
			const geometry = probabilityGridApi.computeGridGeometry?.({
				chartArea: priceChart.chartArea,
				anchorX: model.geometry.anchorX,
				anchorY: model.geometry.anchorY,
				columnCount: strategyPresentation.columns,
				widthFraction: strategyPresentation.width_fraction,
				gapPx: strategyPresentation.gap_px,
				paddingPx: strategyPresentation.padding_px,
				minCellPx: strategyPresentation.min_cell_px,
				rowsAbove: strategyPresentation.rows_above,
				rowsBelow: strategyPresentation.rows_below,
				stepPixels: model.stepPixels,
				cellSizeTargetPx: model.geometry.cellSize,
				limitRowsToChartArea: false,
			});
			if (!geometry) return null;
			const cells = probabilityGridApi.buildProbabilityCells?.({
				distribution,
				geometry,
				anchorPrice: model.anchorPrice,
				mean: model.mean,
				scale: model.scale,
				autoregression: model.autoregression,
				longRunMean: model.longRunMean,
				innovationScale: model.innovationScale,
				stepPixels: model.stepPixels,
				valueForPixel: (pixel) => priceChart.scales.y.getValueForPixel(pixel),
				opacityExponent: strategyPresentation.cell_opacity_exponent,
				opacityTailRatio: strategyPresentation.cell_opacity_tail_ratio,
				cellDisplayThresholdPct: strategyPresentation.cell_display_threshold_pct,
			}) || [];
			if (!cells.length) return null;
			return {
				...model,
				cacheKey: `${model.cacheKey}|detail|${geometry.rowsAbove}|${geometry.rowsBelow}`,
				cells,
				geometry,
			};
		};

		const renderProbabilityTooltip = (index, stackRect, pricePoint) => {
			if (!probabilityTooltip || !priceChart?.chartArea || !priceChart?.scales?.y || !pricePoint) {
				hideProbabilityTooltip();
				return false;
			}
			const baseModel = buildProbabilityGridModel(index, pricePoint);
			if (!baseModel) {
				hideProbabilityTooltip();
				hideProbabilityDetail();
				return false;
			}
			const model = buildProbabilityHoverModel(index, baseModel, pricePoint);
			const {anchorPrice, cells, geometry, mean, scale, stepPixels} = model;
			latestProbabilityDetailIndex = index;
			if (isProbabilityHistoryViewActive()) {
				if (!renderProbabilityDetail(index, baseModel)) {
                    // A chart resize or history-panel transition can leave the
                    // detail viewport at zero for one frame. Retry after the
                    // layout settles so the detail grid cannot retain the
                    // previous presentation (for example, an old threshold).
                    scheduleProbabilityDetailRefresh(3);
                }
            }
			probabilityScrollStackWidth = Math.max(0, Number(stackRect.width) || 0);
			if (probabilityScrollPort instanceof HTMLElement) {
				probabilityScrollPortWidth = Math.max(
					0,
					Number(probabilityScrollPort.clientWidth) || probabilityScrollStackWidth,
				);
			}
			setProbabilityScrollExtent(probabilityScrollVisualPosition);

			const grid = probabilityTooltip.querySelector("[data-backtest-probability-grid]");
			if (!(grid instanceof HTMLElement)) {
				hideProbabilityTooltip();
				return false;
			}
			drawProbabilityCanvas(geometry, cells);
			const canReuseCells = grid.childElementCount === cells.length
				&& Number(grid.dataset.columnCount) === geometry.columnCount
				&& Number(grid.dataset.rowCount) === geometry.rowCount;
			const renderKey = model.cacheKey || String(index);
			const hasDomMirror = Boolean(grid.dataset.renderKey);
			const shouldUpdateDomMirror = !hasDomMirror
				|| isProbabilityHistoryViewActive()
				|| pinState.mode === "pinned";
			const shouldRenderCells = shouldUpdateDomMirror
				&& (!canReuseCells || grid.dataset.renderKey !== renderKey);
			const gridLayoutKey = [
				geometry.columnCount,
				geometry.rowCount,
				geometry.cellSize,
				geometry.gap,
				geometry.gridPaddingTop,
				geometry.gridPaddingBottom,
				geometry.gridPaddingInlineStart,
			].join("|");
			const gridLayoutChanged = grid.dataset.layoutKey !== gridLayoutKey;
			let cellNodes = canReuseCells ? Array.from(grid.children) : [];
			if (shouldRenderCells && !canReuseCells) {
				const fragment = document.createDocumentFragment();
				cellNodes = cells.map(() => {
					const node = document.createElement("span");
					fragment.appendChild(node);
					return node;
				});
				grid.replaceChildren(fragment);
			}
			if (shouldRenderCells) {
				cells.forEach((cell, cellIndex) => applyProbabilityCellNode(
					cellNodes[cellIndex],
					cell,
					"",
					!canReuseCells || gridLayoutChanged,
				));
				grid.dataset.renderKey = renderKey;
			}
			if (shouldUpdateDomMirror && grid.dataset.columnCount !== String(geometry.columnCount)) {
				grid.dataset.columnCount = String(geometry.columnCount);
			}
			if (shouldUpdateDomMirror && grid.dataset.daysPerColumn !== String(geometry.daysPerColumn)) {
				grid.dataset.daysPerColumn = String(geometry.daysPerColumn);
			}
			if (shouldUpdateDomMirror && grid.dataset.rowCount !== String(geometry.rowCount)) {
				grid.dataset.rowCount = String(geometry.rowCount);
			}
			if (shouldUpdateDomMirror && gridLayoutChanged) {
				grid.dataset.layoutKey = gridLayoutKey;
				setInlineStyleIfChanged(
					grid,
					"grid-template-columns",
					`repeat(${geometry.columnCount}, ${geometry.cellSize}px)`,
				);
				setInlineStyleIfChanged(
					grid,
					"grid-template-rows",
					`repeat(${geometry.rowCount}, ${geometry.cellSize}px)`,
				);
				setInlineStyleIfChanged(grid, "gap", `${geometry.gap}px`);
				setInlineStyleIfChanged(
					grid,
					"padding",
					`${geometry.gridPaddingTop}px ${geometry.padding}px ${geometry.gridPaddingBottom}px ${geometry.gridPaddingInlineStart}px`,
				);
			}

			const canvasRect = priceCanvas.getBoundingClientRect();
			const canvasOffsetX = getPriceCanvasContentLeft();
			if (!Number.isFinite(canvasOffsetX)) {
				hideProbabilityTooltip();
				return false;
			}
			const canvasOffsetY = canvasRect.top - stackRect.top;
			setInlineStyleIfChanged(probabilityTooltip, "width", `${geometry.width}px`);
			setInlineStyleIfChanged(probabilityTooltip, "height", `${geometry.height}px`);
			probabilityTooltip.dataset.direction = geometry.direction;
			probabilityTooltip.dataset.pinned = pinState.mode === "pinned" ? "true" : "false";
			probabilityTooltip.hidden = false;
			const fieldPosition = syncProbabilityFieldVisualPosition(
				stackRect,
				geometry,
			);
			if (!fieldPosition) {
				hideProbabilityTooltip();
				return false;
			}
			const upProbability = distribution.probabilityAboveAnchor({...baseModel, horizon: 1});
			probabilityTooltip.setAttribute(
				"aria-label",
				`${labels[index] || "Selected date"}, ${formatMoney(baseModel.anchorPrice)}, ${(upProbability * 100).toFixed(1)}% probability field; displayed from the signal-close anchor; executable target is next-open to-following-open`,
			);
			probabilityTooltip.classList.add("is-visible");
			priceChart._activeBacktestProbabilityGridBounds = {
				...geometry,
				canvasOffsetX,
				canvasOffsetY,
				displayLeft: fieldPosition.left,
				pointerAnchored: fieldPosition.pointerAnchored,
				index,
				intersectionX: pinState.mode !== "pinned"
					&& Number.isFinite(probabilityHoverIntersection?.x)
					? probabilityHoverIntersection.x
					: pricePoint.x,
				intersectionY: pinState.mode !== "pinned"
					&& Number.isFinite(probabilityHoverIntersection?.y)
					? probabilityHoverIntersection.y
					: pricePoint.y,
				maxProbability: Math.max(...cells.map((cell) => cell.probability)),
				minProbability: Math.min(...cells.map((cell) => cell.probability)),
				maxOpacity: Math.max(...cells.map((cell) => cell.opacity)),
				minOpacity: Math.min(...cells.map((cell) => cell.opacity)),
				cellOpacityMapping: strategyPresentation.cell_opacity_mapping,
				cellOpacityExponent: strategyPresentation.cell_opacity_exponent,
				cellOpacityTailRatio: strategyPresentation.cell_opacity_tail_ratio,
				cellDisplayThresholdPct: strategyPresentation.cell_display_threshold_pct,
				thresholdHiddenCount: cells.filter((cell) => cell.isVisible === false).length,
				daysPerColumn: geometry.daysPerColumn,
				slotWidth: geometry.slotWidth,
				stepPixels,
				targetScrollLeft: probabilityScrollTarget,
			};
			return true;
		};
		const refreshActiveProbabilityDetail = () => {
			if (!isProbabilityHistoryViewActive() || !(probabilityDetailPanel instanceof HTMLElement)) return;
			const detailIndex = Number.isInteger(latestProbabilityDetailIndex)
				? latestProbabilityDetailIndex
				: Number(probabilityDetailPanel.dataset.activeIndex);
			if (!Number.isInteger(detailIndex) || detailIndex < 0) return;
			const detailPoint = getDatasetPoint(priceChart, detailIndex, 0);
			const detailModel = buildProbabilityGridModel(detailIndex, detailPoint);
			if (detailModel) renderProbabilityDetail(detailIndex, detailModel);
			else hideProbabilityDetail();
		};
		const scheduleProbabilityDetailRefresh = (passes = 1) => {
			probabilityDetailRefreshPasses = Math.max(
				probabilityDetailRefreshPasses,
				Math.max(1, Number(passes) || 1),
			);
			if (probabilityDetailRefreshFrameId !== null) return;
			const refresh = () => {
				probabilityDetailRefreshFrameId = null;
				if (controllerDestroyed) {
					probabilityDetailRefreshPasses = 0;
					return;
				}
				refreshActiveProbabilityDetail();
				probabilityDetailRefreshPasses -= 1;
				if (probabilityDetailRefreshPasses <= 0) {
					probabilityDetailRefreshPasses = 0;
					return;
				}
				probabilityDetailRefreshFrameId = requestControllerAnimationFrame(refresh);
			};
			probabilityDetailRefreshFrameId = requestControllerAnimationFrame(refresh);
		};
		const refreshProbabilityDetailAfterViewChange = () => {
			if (!isProbabilityHistoryViewActive()) {
				probabilityDetailLayoutObserver?.disconnect?.();
				probabilityDetailLayoutObserver = null;
				refreshActiveProbabilityDetail();
				resultsStack?.dispatchEvent(new Event(PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT));
				return;
			}
			if (typeof ResizeObserver === "function"
				&& !probabilityDetailLayoutObserver
				&& probabilityDetailGrid?.parentElement) {
				probabilityDetailLayoutObserver = new ResizeObserver(() => {
					scheduleProbabilityDetailRefresh();
				});
				probabilityDetailLayoutObserver.observe(probabilityDetailGrid.parentElement);
			}
			refreshActiveProbabilityDetail();
			// The active detail view changes the history rail's minimum demand. Let
			// the shared section resizer recalculate its range after the panel state
			// has been committed.
			resultsStack?.dispatchEvent(new Event(PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT));
			scheduleProbabilityDetailRefresh(2);
		};
		window.addEventListener(
			BACKTEST_HISTORY_VIEW_CHANGE_EVENT,
			refreshProbabilityDetailAfterViewChange,
			{signal: documentController.signal},
		);
		const isProbabilityHoverPointerOverStack = (stackRect) => (
			probabilityHoverPointerActive
			&& Number.isFinite(probabilityHoverPointerX)
			&& Number.isFinite(probabilityHoverPointerY)
			&& probabilityHoverPointerX >= stackRect.left
			&& probabilityHoverPointerX <= stackRect.right
			&& probabilityHoverPointerY >= stackRect.top
			&& probabilityHoverPointerY <= stackRect.bottom
		);

		const updateSharedTooltip = (index, sourceCanvas, sourceChart) => {
			if (index === null) {
				hoverLine.classList.remove("is-visible");
				hoverCrosshairLine.classList.remove("is-visible");
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
				hoverCrosshairLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			const tooltipAnchorPosition = getRelativePointPosition(sourceCanvas, stackRect, sourcePoint);
			if (!tooltipAnchorPosition) {
				hoverLine.classList.remove("is-visible");
				hoverCrosshairLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			let probabilityRendered = false;
			if (activePriceOverlay && pricePoint) {
				probabilityRendered = renderProbabilityTooltip(index, stackRect, pricePoint);
			}
			const currentStackRect = tradeChartStack.getBoundingClientRect();
			const curveHoverLinePosition = getRelativePointPosition(
				canonicalLineCanvas,
				currentStackRect,
				canonicalLinePoint,
			);
			if (!curveHoverLinePosition) {
				hoverLine.classList.remove("is-visible");
				hoverCrosshairLine.classList.remove("is-visible");
				tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			const hoverLinePosition = curveHoverLinePosition;
			if (strategyPresentation) {
				if (probabilityRendered && pinState.mode !== "pinned"
					&& isProbabilityHoverPointerOverStack(currentStackRect)) {
					updatePointerHoverLine();
				} else {
					updateCurveHoverLine();
				}
			} else {
				const hoverLineFrame = updateHoverLineFrame();
				if (hoverLineFrame) {
					hoverLine.style.top = `${hoverLineFrame.top}px`;
					hoverLine.style.height = `${Math.max(0, hoverLineFrame.bottom - hoverLineFrame.top)}px`;
				}
				hoverLine.style.setProperty("--trade-chart-hover-line-x", `${hoverLinePosition.x}px`);
				hoverLine.classList.add("is-visible");
				hoverCrosshairLine.classList.remove("is-visible");
			}
			if (probabilityRendered) {
				tooltip.classList.remove("is-visible");
				return true;
			}
			hideProbabilityTooltip({immediate: sourceCanvas !== priceCanvas});
			const relativeX = hoverLinePosition.x;
			const visualRelativeX = relativeX - probabilityScrollVisualPosition;
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
			const rightSpace = stackRect.width - visualRelativeX;
			const visualLeft = rightSpace >= tooltipWidth + 20
				? visualRelativeX + 14
				: Math.max(12, visualRelativeX - tooltipWidth - 14);
			const left = visualLeft + probabilityScrollVisualPosition;
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
		const getPricePlotFrame = (stackRect) => {
			if (!priceChart?.chartArea || !priceChart?.width || !priceChart?.height) return null;
			const canvasRect = priceCanvas.getBoundingClientRect();
			const canvasContentLeft = getPriceCanvasContentLeft();
			if (!Number.isFinite(canvasContentLeft)) return null;
			const scaleX = canvasRect.width / priceChart.width;
			const scaleY = canvasRect.height / priceChart.height;
			return {
				left: canvasContentLeft + (priceChart.chartArea.left * scaleX),
				right: canvasContentLeft + (priceChart.chartArea.right * scaleX),
				top: canvasRect.top - stackRect.top + (priceChart.chartArea.top * scaleY),
				bottom: canvasRect.top - stackRect.top + (priceChart.chartArea.bottom * scaleY),
			};
		};
		const getProbabilityHoverGuide = (stackRect) => {
			if (!isProbabilityHoverPointerOverStack(stackRect)) return null;
			const pointerScreenX = probabilityHoverPointerX - stackRect.left;
			const resolved = resolveProbabilityPointerIntersection(pointerScreenX, stackRect);
			if (!resolved) return null;
			// Reading a guide must not select a new date or mutate the frame.
			const stableIntersection = probabilityHoverIntersection || resolved.intersection;
			const stableContentX = (resolved.canvasRect.left - stackRect.left)
				+ probabilityScrollVisualPosition + stableIntersection.x * resolved.scaleX;
			return {
				contentX: stableContentX,
				intersection: stableIntersection,
				lastContentX: resolved.lastContentX,
				pointerScreenX,
				visualY: resolved.canvasRect.top - stackRect.top
					+ (Number(stableIntersection.y) * resolved.scaleY),
			};
		};
		const getProbabilityFieldContentLeft = (stackRect, geometry) => {
			if (
				strategyPresentation
				&& pinState.mode !== "pinned"
				&& isProbabilityHoverPointerOverStack(stackRect)
			) {
				const guide = getProbabilityHoverGuide(stackRect);
				if (Number.isFinite(guide?.contentX)) {
					// The guide owns the origin even when trailing columns are clipped.
					return guide.contentX;
				}
			}
			const canvasContentLeft = getPriceCanvasContentLeft();
			return Number.isFinite(canvasContentLeft)
				? canvasContentLeft + Number(geometry?.left || 0)
				: null;
		};
		const getProbabilityGeometryVisualY = (stackRect, geometry) => {
			if (!geometry || !priceChart?.height) return null;
			const canvasRect = priceCanvas.getBoundingClientRect();
			const scaleY = canvasRect.height / Number(priceChart.height);
			const anchorY = Number(geometry.anchorY);
			if (!Number.isFinite(scaleY) || !(scaleY > 0) || !Number.isFinite(anchorY)) {
				return null;
			}
			return canvasRect.top - stackRect.top + (anchorY * scaleY);
		};
		const syncProbabilityFieldVisualPosition = (
			stackRect,
			geometry,
		) => {
			if (!(probabilityTooltip instanceof HTMLElement) || !geometry) return null;
			// The caller's rectangle can predate a responsive/layout pass.
			const currentStackRect = tradeChartStack.getBoundingClientRect();
			const contentLeft = getProbabilityFieldContentLeft(currentStackRect, geometry);
			const pointerAnchored = (
				strategyPresentation
				&& pinState.mode !== "pinned"
				&& isProbabilityHoverPointerOverStack(currentStackRect)
			);
			const canvasRect = priceCanvas.getBoundingClientRect();
			const intersectionGuide = pointerAnchored
				? getProbabilityHoverGuide(currentStackRect)
				: null;
			const geometryVisualY = pointerAnchored
				? getProbabilityGeometryVisualY(currentStackRect, geometry)
				: null;
			const intersectionTop = Number.isFinite(geometryVisualY)
				? geometryVisualY
				: Number.isFinite(intersectionGuide?.visualY)
					? intersectionGuide.visualY
				: Number.NaN;
			const visualTop = Number.isFinite(intersectionTop)
				? intersectionTop - Number(geometry.aboveExtent || 0)
				: canvasRect.top - currentStackRect.top + Number(geometry.top || 0);
			setInlineStyleIfChanged(
				probabilityTooltip,
				"transform",
				`translate3d(${contentLeft}px, ${visualTop}px, 0)`,
			);
			return {
				left: contentLeft,
				right: contentLeft + Number(geometry.width || 0),
				pointerAnchored,
			};
		};
		const updateHoverCrosshair = (x, y, plotFrame, horizontalEnd = null) => {
			if (!Number.isFinite(x) || !Number.isFinite(y) || !plotFrame) return false;
			const resolvedHorizontalEnd = Number.isFinite(horizontalEnd)
				? Math.max(plotFrame.right, horizontalEnd)
				: plotFrame.right;
			const hoverLineFrame = updateHoverLineFrame();
			if (hoverLineFrame) {
				hoverLine.style.top = `${hoverLineFrame.top}px`;
				hoverLine.style.height = `${Math.max(0, hoverLineFrame.bottom - hoverLineFrame.top)}px`;
			}
			hoverLine.style.setProperty("--trade-chart-hover-line-x", `${x}px`);
			hoverLine.classList.add("is-visible");
			const fixedPlotLeft = plotFrame.left + probabilityScrollVisualPosition;
			hoverCrosshairLine.style.left = `${fixedPlotLeft}px`;
			hoverCrosshairLine.style.width = `${Math.max(0, resolvedHorizontalEnd - fixedPlotLeft)}px`;
			hoverCrosshairLine.style.top = `${y}px`;
			hoverCrosshairLine.classList.add("is-visible");
			updateHoverDateLabel(x, plotFrame.bottom, activeIndex);
			if (probabilityHint) {
				const bounds = priceChart?._activeBacktestProbabilityGridBounds;
				const empty = bounds && bounds.maxOpacity === 0;
				const overflow = horizontalEnd - probabilityScrollVisualPosition > tradeChartStack.clientWidth + 1;
				const copy = empty
					? `All cells below ${Number(strategyPresentation.cell_display_threshold_pct).toFixed(2)}% · max ${(bounds.maxProbability * 100).toFixed(2)}%`
					: overflow ? "Drag left to explore future cells" : "";
				if (probabilityHint.textContent !== copy) probabilityHint.textContent = copy;
				probabilityHint.style.left = `${plotFrame.left + 8}px`;
				probabilityHint.style.top = `${plotFrame.top + 8}px`;
				probabilityHint.hidden = !copy;
				tradeChartStack.classList.toggle("has-probability-overflow", overflow);
			}
			// The Y-axis badge is painted by the Chart.js overlay plugin. Redraw
			// after the pointer guide has settled so its value follows the exact
			// curve intersection rather than the nearest source point.
			priceChart?.draw?.();
			return true;
		};
		const updatePointerHoverLine = () => {
			if (
				!strategyPresentation
				|| !activePriceOverlay
				|| pinState.mode === "pinned"
				|| !Number.isInteger(activeIndex)
			) return;
			let currentStackRect = tradeChartStack.getBoundingClientRect();
			if (!isProbabilityHoverPointerOverStack(currentStackRect)) return;
			const currentPricePoint = getDatasetPoint(priceChart, activeIndex, 0);
			let probabilityBounds = priceChart._activeBacktestProbabilityGridBounds;
			if (!currentPricePoint || !probabilityBounds) return;
			syncProbabilityFieldVisualPosition(currentStackRect, probabilityBounds);
			currentStackRect = tradeChartStack.getBoundingClientRect();
			let plotFrame = getPricePlotFrame(currentStackRect);
			let guide = getProbabilityHoverGuide(currentStackRect);
			if (
				guide?.intersection
				&& Math.abs(Number(guide.intersection.y) - Number(probabilityBounds.anchorY)) > 0.01
			) {
				// A scroll or visual translation can settle after the original render.
				// Rebuild the floating lattice from that final intersection instead of
				// leaving its cells attached to the previous frame's Y coordinate.
				if (renderProbabilityTooltip(activeIndex, currentStackRect, currentPricePoint)) {
					probabilityBounds = priceChart._activeBacktestProbabilityGridBounds;
					currentStackRect = tradeChartStack.getBoundingClientRect();
					plotFrame = getPricePlotFrame(currentStackRect);
					guide = getProbabilityHoverGuide(currentStackRect);
				}
			}
			const fieldLeft = getProbabilityFieldContentLeft(currentStackRect, probabilityBounds);
			const fieldRight = fieldLeft + Number(probabilityBounds.width || 0);
			const geometryVisualY = getProbabilityGeometryVisualY(currentStackRect, probabilityBounds);
			if (updateHoverCrosshair(
				guide?.contentX,
				Number.isFinite(geometryVisualY) ? geometryVisualY : guide?.visualY,
				plotFrame,
				Number.isFinite(fieldRight) ? fieldRight : null,
			)) {
				probabilityBounds.displayLeft = fieldLeft;
				probabilityBounds.targetScrollLeft = probabilityScrollTarget;
				probabilityBounds.pointerAnchored = true;
				if (guide?.intersection) {
					probabilityBounds.intersectionX = guide.intersection.x;
					probabilityBounds.intersectionY = guide.intersection.y;
				}
			}
		};
		const updateCurveHoverLine = () => {
			if (!Number.isInteger(activeIndex)) return;
			const currentStackRect = tradeChartStack.getBoundingClientRect();
			const currentPricePoint = getDatasetPoint(priceChart, activeIndex, 0);
			if (!currentPricePoint) return;
			const curveHoverLinePosition = getRelativePointPosition(
				priceCanvas,
				currentStackRect,
				currentPricePoint,
			);
			if (!curveHoverLinePosition) return;
			const probabilityBounds = priceChart._activeBacktestProbabilityGridBounds;
			if (probabilityBounds) {
				syncProbabilityFieldVisualPosition(currentStackRect, probabilityBounds);
			}
			const fieldRight = getProbabilityFieldContentLeft(currentStackRect, probabilityBounds)
				+ Number(probabilityBounds?.width || 0);
			updateHoverCrosshair(
				curveHoverLinePosition.x,
				curveHoverLinePosition.y,
				getPricePlotFrame(currentStackRect),
				Number.isFinite(fieldRight) ? fieldRight : null,
			);
		};
		probabilityFieldPositionUpdater = () => {
			if (!activePriceOverlay || pinState.mode === "pinned") return;
			const bounds = priceChart?._activeBacktestProbabilityGridBounds;
			if (!bounds || !probabilityTooltip?.classList.contains("is-visible")) return;
			const currentStackRect = tradeChartStack.getBoundingClientRect();
			if (isProbabilityHoverPointerOverStack(currentStackRect)) {
				// Scroll and visual translation move the overlay after the pointer
				// event. Recompute both lines in that same frame so they cannot
				// drift apart while the field follows the pointer.
				commitProbabilityPointerFrame({synchronizeScroll: false});
				return;
			}
			// Once the pointer is on the native rail, the chart is no longer a
			// pointer-anchored surface. Keep the active field attached to its
			// selected curve point while the rail moves.
			updateCurveHoverLine();
		};
		const commitProbabilityPointerFrame = ({synchronizeScroll = true} = {}) => {
			if (pinState.mode === "pinned" || !priceChart?.ctx) return;
			const stackRect = tradeChartStack.getBoundingClientRect();
			if (!isProbabilityHoverPointerOverStack(stackRect)) return;
			cancelScheduledHoverSync();
			const pointerX = probabilityHoverPointerX - stackRect.left;
			const initial = resolveProbabilityPointerIntersection(pointerX, stackRect);
			if (!initial) return;
			if (synchronizeScroll && !probabilityPanGesture?.dragging) {
				const point = getDatasetPoint(priceChart, initial.intersection.index, 0);
				const model = buildProbabilityGridModel(initial.intersection.index, point);
				const fieldWidth = Number(model?.geometry?.width) || 0;
				// Solve pan from screen X and static dimensions, not from the prior
				// pan or field rectangle. The endpoint must not move left of the
				// cursor. Rendering then consumes this single settled coordinate frame.
				const nextTarget = Math.min(
					Math.max(0, pointerX + fieldWidth - stackRect.width + probabilityManualPanOffset),
					Math.max(0, initial.lastContentX - pointerX),
				);
				if (Math.abs(nextTarget - probabilityScrollTarget) > 0.01) {
					const wasUpdating = isUpdatingProbabilityFieldPosition;
					isUpdatingProbabilityFieldPosition = true;
					try {
						setProbabilityScrollTarget(nextTarget, {immediate: true});
					} finally {
						isUpdatingProbabilityFieldPosition = wasUpdating;
					}
				}
			}
			const settled = resolveProbabilityPointerIntersection(pointerX, stackRect);
			if (!settled) return;
			probabilityHoverIntersection = settled.intersection;
			const index = settled.intersection.index;
			pinState = probabilityGridApi.reducePinState?.(pinState, {type: "track", index})
				|| {mode: "tracking", activeIndex: index};
			if (index !== activeIndex || activeSourceCanvas !== priceCanvas) {
				syncHoverState(index, priceCanvas, priceChart);
			} else {
				updatePointerHoverLine();
			}
		};
		const schedulePointerHoverLineUpdate = () => {
			if (pointerHoverFrameId !== null) return;
			pointerHoverFrameId = requestControllerAnimationFrame(() => {
				pointerHoverFrameId = null;
				commitProbabilityPointerFrame();
			});
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
			const showTradeDetails = isBacktestTradeDetailsEnabled();
			const setActive = (chart) => {
				if (!chart || !chart.ctx) return;
				if (chart === equityChart && !showTradeDetails) return;
				chart.setActiveElements(index === null ? [] : [{ datasetIndex: 0, index }]);
				if (typeof chart.draw === "function") chart.draw();
				else chart.update("none");
			};
			setActive(priceChart);
			setActive(equityChart);
			const probabilityRendered = updateSharedTooltip(index, sourceCanvas, sourceChart);

			if (!showTradeDetails || index === null) {
				activateBacktestRows([], null);
			} else {
				const scrollContainer = document.querySelector("#tradeTransactionsTable")?.closest(".scrollable-data-table-scroll");
				const rows = Array.from(document.querySelectorAll(`#tradeTransactionsTable tbody tr[data-chart-index="${index}"]`));
				activateBacktestRows(rows, scrollContainer);
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
			if (
				index === activeIndex
				&& sourceCanvas === activeSourceCanvas
				&& sourceChart === activeSourceChart
			) {
				cancelScheduledHoverSync();
				return;
			}
			if (
				pendingHoverUpdate?.index === index
				&& pendingHoverUpdate.sourceCanvas === sourceCanvas
				&& pendingHoverUpdate.sourceChart === sourceChart
			) return;
			pendingHoverUpdate = {index, sourceCanvas, sourceChart};
			if (hoverFrameId !== null) return;
			hoverFrameId = requestControllerAnimationFrame(() => {
				hoverFrameId = null;
				const pending = pendingHoverUpdate;
				pendingHoverUpdate = null;
				if (!pending || pinState.mode === "pinned" || !pending.sourceChart?.ctx) return;
				if (
					pending.index === activeIndex
					&& pending.sourceCanvas === activeSourceCanvas
					&& pending.sourceChart === activeSourceChart
				) return;
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
			const hoverSurface = canvas === priceCanvas && strategyPresentation
				? tradeChartStack
				: canvas;

			hoverSurface.addEventListener("mousemove", (event) => {
				if (!chart || !chart.ctx) return;
				if (pinState.mode === "pinned") return;
				if (
					canvas === priceCanvas
					&& strategyPresentation
					&& event.target instanceof Node
					&& equityCanvas?.closest(".trade-chart-panel")?.contains(event.target)
				) return;
				if (canvas === priceCanvas && strategyPresentation) {
					// Cancel the equity leave frame before it can clear the new price pointer.
					cancelScheduledHoverSync();
					probabilityHoverPointerX = Number(event.clientX);
					probabilityHoverPointerY = Number(event.clientY);
					probabilityHoverPointerActive = true;
					schedulePointerHoverLineUpdate();
					return;
				}
				scheduleHoverSync(resolveNearestHoverIndex(chart, event), canvas, chart);
			}, { signal });

			if (canvas !== priceCanvas || !strategyPresentation) {
				canvas.addEventListener("mouseleave", () => {
					if (!chart || !chart.ctx) return;
					if (pinState.mode === "pinned") return;
					scheduleHoverSync(null, canvas, chart);
				}, { signal });
			}

			if (canvas === priceCanvas && strategyPresentation) {
				hoverSurface.addEventListener("mouseleave", (event) => {
					if (!chart || !chart.ctx) return;
					if (probabilityPanGesture) return;
					if (pinState.mode === "pinned") return;
					if (isProbabilityAuxiliarySurface(event.relatedTarget)) return;
					resetProbabilityHoverPointer();
					scheduleHoverSync(null, canvas, chart);
				}, { signal });
			}

			if (canvas === priceCanvas && strategyPresentation) {
				const isPrimaryPointer = (event) => (
					event.button === 0
					|| (event.pointerType === "touch" && event.button === -1)
				);
				const pinProbabilityAtPointer = (event) => {
					if (!chart || !chart.ctx) return;
					cancelScheduledHoverSync();
					const nearestIndex = resolveNearestHoverIndex(chart, event);
					const trackedIndex = pinState.mode !== "pinned"
						&& activePriceOverlay
						&& probabilityTooltip?.classList.contains("is-visible")
						&& Number.isInteger(activeIndex)
						? activeIndex
						: nearestIndex;
					const point = Number.isInteger(trackedIndex)
						? chart.getDatasetMeta(0)?.data?.[trackedIndex]
						: null;
					const canvasRect = canvas.getBoundingClientRect();
					const pointerY = event.clientY - canvasRect.top;
					const isCurvePress = Number.isInteger(trackedIndex)
						&& probabilityGridApi.isPointNearCurve?.(pointerY, point?.y, 14);
					const probabilityRendered = isCurvePress
						? renderProbabilityTooltip(
							trackedIndex,
							tradeChartStack.getBoundingClientRect(),
							point,
						)
						: false;
					if (probabilityRendered) {
						pinState = probabilityGridApi.reducePinState?.(
							pinState,
							{type: "pin", index: trackedIndex},
						) || {mode: "pinned", activeIndex: trackedIndex};
						snapProbabilityScrollToFit();
						syncHoverState(trackedIndex, canvas, chart);
						return true;
					}
					if (pinState.mode === "pinned") {
						pinState = probabilityGridApi.reducePinState?.(pinState, {type: "clear"})
							|| {mode: "tracking", activeIndex: null};
						syncHoverState(null, canvas, chart);
						return true;
					} else if (isCurvePress) {
						pinState = probabilityGridApi.reducePinState?.(
							pinState,
							{type: "track", index: trackedIndex},
						) || {mode: "tracking", activeIndex: trackedIndex};
						syncHoverState(trackedIndex, canvas, chart);
						return true;
					}
					return false;
				};
				let suppressNextProbabilityClick = false;
				hoverSurface.addEventListener("pointerdown", (event) => {
					if (!isPrimaryPointer(event)) return;
					if (pinState.mode !== "pinned") {
						probabilityHoverPointerX = event.clientX;
						probabilityHoverPointerY = event.clientY;
						probabilityHoverPointerActive = true;
						// A press targets the curve currently on screen, including a
						// touch tap with no preceding hover. Do not move it on press.
						commitProbabilityPointerFrame({synchronizeScroll: false});
					}
					if (pinState.mode !== "pinned" && activePriceOverlay
						&& tradeChartStack.classList.contains("has-probability-overflow")) {
						probabilityPanGesture = {
							pointerId: event.pointerId, startX: event.clientX,
							startPan: probabilityScrollVisualPosition, dragging: false,
						};
						const point = getDatasetPoint(chart, activeIndex, 0);
						const curvePress = probabilityGridApi.isPointNearCurve?.(
							event.clientY - canvas.getBoundingClientRect().top, point?.y, 14,
						);
						if (curvePress) {
							// Keep primary-press pin feedback, but defer its viewport snap
							// until release so a subsequent drag starts without a jump.
							probabilityPanGesture.provisionalPin = true;
							pinState = {mode: "pinned", activeIndex};
							probabilityTooltip.dataset.pinned = "true";
						}
						// Keep the compatibility click owned by the price canvas. A
						// stack-targeted click is otherwise interpreted as an outside click.
						canvas.setPointerCapture(event.pointerId);
						return;
					}
					suppressNextProbabilityClick = pinProbabilityAtPointer(event) === true;
				}, { signal });
				hoverSurface.addEventListener("pointermove", (event) => {
					const gesture = probabilityPanGesture;
					if (!gesture || gesture.pointerId !== event.pointerId) return;
					const delta = gesture.startX - event.clientX;
					if (!gesture.dragging && Math.abs(delta) < 4) return;
					gesture.dragging = true;
					if (gesture.provisionalPin) {
						pinState = {mode: "tracking", activeIndex};
						probabilityTooltip.dataset.pinned = "false";
						gesture.provisionalPin = false;
					}
					event.preventDefault();
					tradeChartStack.classList.add("is-probability-dragging");
					probabilityHoverPointerX = event.clientX;
					probabilityHoverPointerY = event.clientY;
					probabilityHoverPointerActive = true;
					const rect = tradeChartStack.getBoundingClientRect();
					const pointerX = event.clientX - rect.left;
					const resolved = resolveProbabilityPointerIntersection(pointerX, rect);
					if (!resolved) return;
					const nextPan = Math.min(Math.max(0, gesture.startPan + delta),
						Math.max(0, resolved.lastContentX - pointerX));
					const wasUpdating = isUpdatingProbabilityFieldPosition;
					isUpdatingProbabilityFieldPosition = true;
					try { setProbabilityScrollTarget(nextPan, {immediate: true}); }
					finally { isUpdatingProbabilityFieldPosition = wasUpdating; }
					commitProbabilityPointerFrame({synchronizeScroll: false});
				}, {signal});
				const finishProbabilityDrag = (event) => {
					const gesture = probabilityPanGesture;
					if (!gesture || gesture.pointerId !== event.pointerId) return;
					probabilityPanGesture = null;
					tradeChartStack.classList.remove("is-probability-dragging");
					if (gesture.provisionalPin) pinState = {mode: "tracking", activeIndex};
					if (gesture.dragging) {
						const rect = tradeChartStack.getBoundingClientRect();
						const width = Number(priceChart._activeBacktestProbabilityGridBounds?.width) || 0;
						probabilityManualPanOffset = probabilityScrollVisualPosition
							- (probabilityHoverPointerX - rect.left + width - rect.width);
						suppressNextProbabilityClick = true;
					} else if (event.type === "pointerup") {
						suppressNextProbabilityClick = pinProbabilityAtPointer(event) === true;
					}
					if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
					if (event.type === "pointercancel"
						|| !isProbabilityHoverPointerOverStack(tradeChartStack.getBoundingClientRect())) {
						resetProbabilityHoverPointer();
						syncHoverState(null, canvas, chart);
					}
				};
				hoverSurface.addEventListener("pointerup", finishProbabilityDrag, {signal});
				hoverSurface.addEventListener("pointercancel", finishProbabilityDrag, {signal});
				hoverSurface.addEventListener("lostpointercapture", finishProbabilityDrag, {signal});
				canvas.addEventListener("click", (event) => {
					if (suppressNextProbabilityClick && event.detail > 0) {
						suppressNextProbabilityClick = false;
						return;
					}
					suppressNextProbabilityClick = false;
					pinProbabilityAtPointer(event);
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
				if (document.getElementById("workspace_panel")?.dataset.workspacePending !== "1") {
					bootstrap.setBacktestLoadState?.("ready");
				}
				bootstrap.workspaceShare?.dispatchReady?.("backtest");
			}
		};
		const resolveChartReadyAnimation = (canvas) => {
			const readyScheduler = window.WorthwardMotion?.scheduler;
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
						pointHoverRadius: 0,
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
				xAxisLabelPlugin,
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
			plugins: [xAxisLabelPlugin],
		});

		const initTransactionsPagination = () => {
			const table = document.getElementById("tradeTransactionsTable");
			const nav = document.getElementById("tradeTransactionsPagination");
			const tableShell = document.getElementById("backtest_history_table_wrap");
			const tbody = table?.querySelector("tbody");
			const paginationApi = window.WORTHWARD_LOCAL_STORE_PAGINATION;
			if (!table || !nav || !tbody) return;
			if (!paginationApi) {
				window.addEventListener("worthward:local-store-pagination-ready", initTransactionsPagination, {once: true, signal: documentController.signal});
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
				const renderer = window.WORTHWARD_NUMERIC_DISPLAY?.renderNumericDisplayContent;
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
			const requestedPage = window.WORTHWARD_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href)?.page || 1;
			goToPage(requestedPage);
			syncTablePageUrl(currentPage);
		};

		attachHover(priceCanvas, priceChart);
		attachHover(equityCanvas, equityChart);
		if (strategyPresentation) {
			const isProbabilityHoverSurface = (target) => (
				target instanceof Node
				&& (
					tradeChartStack.contains(target)
					|| isProbabilityAuxiliarySurface(target)
				)
			);
			const clearProbabilityFieldOnLeave = (relatedTarget) => {
				if (probabilityPanGesture) return;
				const remainsOnProbabilitySurface = isProbabilityHoverSurface(relatedTarget);
				probabilityHoverPointerActive = remainsOnProbabilitySurface
					&& tradeChartStack.contains(relatedTarget);
				if (remainsOnProbabilitySurface) {
					if (!probabilityHoverPointerActive) updateCurveHoverLine();
					return;
				}
				if (!priceChart?.ctx || pinState.mode === "pinned") return;
				cancelScheduledHoverSync();
				if (pointerHoverFrameId !== null) {
					cancelControllerAnimationFrame(pointerHoverFrameId);
					pointerHoverFrameId = null;
				}
				pinState = probabilityGridApi.reducePinState?.(pinState, {type: "clear"})
					|| {mode: "tracking", activeIndex: null};
				syncHoverState(null, priceCanvas, priceChart);
			};
			tradeChartStack.addEventListener("mouseleave", (event) => {
				clearProbabilityFieldOnLeave(event.relatedTarget);
			}, {signal: documentController.signal});
				probabilityScrollPort?.addEventListener("mouseleave", (event) => {
					clearProbabilityFieldOnLeave(event.relatedTarget);
				}, {signal: documentController.signal});
				probabilityScrollResizer?.addEventListener("mouseleave", (event) => {
					clearProbabilityFieldOnLeave(event.relatedTarget);
				}, {signal: documentController.signal});
		}
		// Probability cells are clipped to the existing Chart.js plot area. They
		// must not expand Y-axis padding or change the curve's drawing range.
		const resolvePriceChartYPadding = () => chartYPaddingPx;
		priceChartYPadding = resolvePriceChartYPadding();
		applyBacktestYAxisScale(
			priceChart,
			priceCanvas,
			[priceChart.data.datasets[0].data],
			priceChartYPadding,
		);
		priceChart.update("none");
		if (strategyPresentation) {
			const defaultIndex = strategyPresentation.predictive_mean.reduce(
				(latestIndex, meanValue, index) => (
					Number.isFinite(Number(meanValue))
						&& Number(strategyPresentation.predictive_scale?.[index]) > 0
						&& Number(close[index]) > 0
						? index
						: latestIndex
				),
				-1,
			);
			const defaultPoint = getDatasetPoint(priceChart, defaultIndex, 0);
			const defaultModel = defaultIndex >= 0
				? buildProbabilityGridModel(defaultIndex, defaultPoint)
				: null;
            if (defaultModel) {
                if (!renderProbabilityDetail(defaultIndex, defaultModel)) {
                    scheduleProbabilityDetailRefresh(3);
                }
            } else hideProbabilityDetail();
		}
		publishProbabilityStageMinimum();
		const refreshChartLayout = ({chartsAlreadyResized = false} = {}) => {
			if (controllerDestroyed || !priceChart?.ctx || !equityChart?.ctx) return;
			const showTradeDetails = isBacktestTradeDetailsEnabled();
			const refreshIndex = pinState.mode === "pinned"
				? pinState.activeIndex
				: activeIndex;
			const refreshSourceCanvas = !showTradeDetails || pinState.mode === "pinned"
				? priceCanvas
				: activeSourceCanvas;
			const refreshSourceChart = !showTradeDetails || pinState.mode === "pinned"
				? priceChart
				: activeSourceChart;
			if (!chartsAlreadyResized) priceChart.resize();
			if (showTradeDetails && !chartsAlreadyResized) equityChart.resize();
			const stackRectAfterResize = tradeChartStack.getBoundingClientRect();
			const pointerStillOverStack = isProbabilityHoverPointerOverStack(stackRectAfterResize);
			const previousViewportWidth = Number(
				tradeChartStack.dataset.probabilityLayoutViewportWidth,
			);
			const viewportWidthChanged = Number.isFinite(previousViewportWidth)
				&& Math.abs(previousViewportWidth - window.innerWidth) > 1;
			tradeChartStack.dataset.probabilityLayoutViewportWidth = String(window.innerWidth);
			// Keep a live pointer across vertical split changes so Home/End can
			// recompute overflow pan without another mousemove. A viewport-width
			// change invalidates client coordinates, so drop that pointer.
			if (!pointerStillOverStack || viewportWidthChanged) {
				resetProbabilityHoverPointer();
			}
			chartHoverPointCaches.clear();
			probabilityHoverLayout = null;
			probabilityModelCache.clear();
			priceChartYPadding = resolvePriceChartYPadding();
			applyBacktestYAxisScale(
				priceChart,
				priceCanvas,
				[priceChart.data.datasets[0].data],
				priceChartYPadding,
			);
			if (showTradeDetails) {
				applyBacktestYAxisScale(
					equityChart,
					equityCanvas,
					[equityChart.data.datasets[0].data, equityChart.data.datasets[1].data],
					chartYPaddingPx,
				);
			}
			if (Number.isInteger(refreshIndex) && refreshSourceCanvas && refreshSourceChart?.ctx) {
				if (pointerStillOverStack && !viewportWidthChanged && pinState.mode !== "pinned") {
					const resizedIntersection = resolveProbabilityPointerIntersection(
						probabilityHoverPointerX - stackRectAfterResize.left, stackRectAfterResize,
					)?.intersection;
					probabilityHoverIntersection = resizedIntersection;
				}
				syncHoverState(refreshIndex, refreshSourceCanvas, refreshSourceChart);
				if (pointerStillOverStack && !viewportWidthChanged) {
					commitProbabilityPointerFrame();
				}
			} else {
				priceChart.update("none");
				if (showTradeDetails) equityChart.update("none");
			}
			publishProbabilityStageMinimum();
			if (strategyPresentation && isProbabilityHistoryViewActive() && Number.isInteger(latestProbabilityDetailIndex)) {
				const detailIndex = latestProbabilityDetailIndex;
				const detailPoint = getDatasetPoint(priceChart, detailIndex, 0);
				const detailModel = buildProbabilityGridModel(detailIndex, detailPoint);
				if (detailModel) renderProbabilityDetail(detailIndex, detailModel);
				scheduleProbabilityDetailRefresh(2);
			}
		};
		const scheduleChartLayoutRefresh = () => {
			if (layoutFrameId !== null || controllerDestroyed) return;
			layoutFrameId = requestControllerAnimationFrame(() => {
				layoutFrameId = null;
				refreshChartLayout();
			});
		};
		const refreshAfterSharedChartResize = () => {
			if (layoutFrameId !== null) {
				cancelControllerAnimationFrame(layoutFrameId);
				layoutFrameId = null;
			}
			refreshChartLayout({chartsAlreadyResized: true});
		};
		bootstrap.backtestChartLayoutRefresh = refreshAfterSharedChartResize;
		window.addEventListener("resize", scheduleChartLayoutRefresh, {signal: documentController.signal});
		window.addEventListener(
			"worthward:backtest-trade-details-change",
			scheduleChartLayoutRefresh,
			{signal: documentController.signal},
		);
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
			update: scheduleChartLayoutRefresh,
			destroy() {
				if (controllerDestroyed) return;
				controllerDestroyed = true;
				cancelScheduledHoverSync();
				if (pointerHoverFrameId !== null) {
					cancelControllerAnimationFrame(pointerHoverFrameId);
					pointerHoverFrameId = null;
				}
				if (layoutFrameId !== null) {
					cancelControllerAnimationFrame(layoutFrameId);
					layoutFrameId = null;
				}
				if (probabilityDetailRefreshFrameId !== null) {
					cancelControllerAnimationFrame(probabilityDetailRefreshFrameId);
					probabilityDetailRefreshFrameId = null;
				}
				probabilityDetailRefreshPasses = 0;
				probabilityDetailLayoutObserver?.disconnect?.();
				probabilityDetailLayoutObserver = null;
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
				probabilityScrollCleanup?.();
				probabilityScrollCleanup = null;
				probabilityScrollTarget = 0;
				probabilityScrollVisualPosition = 0;
				probabilityScrollVelocity = 0;
				probabilityScrollLastTimestamp = null;
				setProbabilityScrollPosition(0);
				setProbabilityScrollPortActive(false);
				clearProbabilityStageMinimum();
				tradeChartStack.classList.remove("has-probability-field");
				delete tradeChartStack.dataset.probabilityPanState;
				delete tradeChartStack.dataset.probabilityPanTarget;
				delete tradeChartStack.dataset.probabilityPanMotion;
				delete tradeChartStack.dataset.probabilityPanVisualOffset;
				delete tradeChartStack.dataset.probabilityPanVisualPosition;
				activateBacktestRows([], null);
				hoverLine.remove();
				hoverCrosshairLine.remove();
				hoverDateLabel.remove();
				fixedPriceAxis?.remove();
				probabilityHint?.remove();
				probabilityDetailPanel?.querySelector(".backtest-probability-empty-state")?.remove();
				tradeChartStack.classList.remove("has-probability-overflow", "is-probability-dragging");
				tooltip.remove();
				probabilityTooltip?.remove();
				probabilityScrollSpacer?.remove();
				hideProbabilityDetail();
				priceChart?.destroy?.();
				equityChart?.destroy?.();
				if (bootstrap.backtestChartLayoutRefresh === refreshAfterSharedChartResize) {
					delete bootstrap.backtestChartLayoutRefresh;
				}
			},
		};
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
		return hoverController;
	};

	const createController = ({
		isBacktestTradeDetailsEnabled = () => false,
		distributionRegistry = globalScope.WORTHWARD_PRICE_FIELD_DISTRIBUTIONS.createRegistry(),
	} = {}) => {
		let runtime = null;
		let mountedState = null;
		const controller = Object.freeze({
			mount(state = globalScope.WORTHWARD_APP) {
				controller.destroy();
				mountedState = state;
				runtime = mountCharts(state, isBacktestTradeDetailsEnabled, distributionRegistry) || null;
				return controller;
			},
			update(state = mountedState) {
				if (state !== mountedState) return controller.mount(state);
				runtime?.update();
				return controller;
			},
			destroy() {
				runtime?.destroy();
				runtime = null;
				mountedState = null;
			},
		});
		return controller;
	};
	globalScope.WORTHWARD_BACKTEST_CHART_CONTROLLER = Object.freeze({createController});
})(typeof globalThis !== "undefined" ? globalThis : window);
