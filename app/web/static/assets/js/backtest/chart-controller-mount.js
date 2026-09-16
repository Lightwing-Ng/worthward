/* Code version: v1.2.0 */
/**
 * Owns the synchronized Price/Equity chart runtime, including probability-field
 * DOM, pointer capture, caches, animation frames, observers, and teardown.
 * The workspace supplies data and preferences; distribution adapters supply math.
 */
(function bootstrapBacktestChartControllerMount(globalScope) {
	"use strict";
	const bootstrap = globalScope.WORTHWARD_BOOTSTRAP = globalScope.WORTHWARD_BOOTSTRAP || {};
	const backtestThemeState = bootstrap.backtestThemeState = bootstrap.backtestThemeState || {};
	const chartAxis = window.WORTHWARD_CHART_AXIS || {};
	const probabilityGridApi = window.WORTHWARD_BACKTEST_PROBABILITY_GRID || {};
	const PROBABILITY_STAGE_MINIMUM_PROPERTY = "--backtest-probability-stage-min-height";
	const PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT = "worthward:backtest-probability-stage-minimum-change";
	const PROBABILITY_STAGE_MINIMUM_LAYOUT_BUFFER_PX = 1;
	const BACKTEST_HISTORY_VIEW_CHANGE_EVENT = "worthward:backtest-history-view-change";
	const PROBABILITY_MODEL_CACHE_LIMIT = 24;
	let detailModulePromise = null;
	const hasDetailModuleApi = () => (
		typeof window.WORTHWARD_PRICE_FIELD_DETAIL_CHART?.computePlotWidth === "function"
		&& typeof window.WORTHWARD_PRICE_FIELD_DETAIL_CHART?.computeLayout === "function"
	);
	const loadDetailModule = () => {
		if (hasDetailModuleApi()) return Promise.resolve();
		if (!detailModulePromise) detailModulePromise = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = "/static/assets/js/backtest/detail-chart.js?v=backtest-detail-chart-v1.5.0";
			script.onload = () => hasDetailModuleApi()
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
		nextAllInLeveraged,
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
		const hasLeveragedBenchmark = Boolean(
			equityChart.data.datasets[2]
			&& Array.isArray(nextAllInLeveraged)
			&& nextAllInLeveraged.length,
		);
		const fromAllInLeveraged = hasLeveragedBenchmark
			? buildAlignedSeries(
				transition.rawLabels,
				transition.allInLeveraged,
				nextRawLabels,
				nextAllInLeveraged,
			)
			: null;

		priceChart.data.datasets[0].data = fromClose;
		equityChart.data.datasets[0].data = fromEquity;
		equityChart.data.datasets[1].data = fromAllIn;
		if (hasLeveragedBenchmark) equityChart.data.datasets[2].data = fromAllInLeveraged;
		applyBacktestYAxisScale(priceChart, priceChart.canvas, [fromClose], resolvePadding(getPriceYPadding));
		applyBacktestYAxisScale(
			equityChart,
			equityChart.canvas,
			[fromEquity, fromAllIn, ...(hasLeveragedBenchmark ? [fromAllInLeveraged] : [])],
			resolvePadding(getEquityYPadding),
		);
		priceChart.update("none");
		equityChart.update("none");

		const startSeries = [
			priceChart.data.datasets[0].data.slice(),
			equityChart.data.datasets[0].data.slice(),
			equityChart.data.datasets[1].data.slice(),
			...(hasLeveragedBenchmark ? [equityChart.data.datasets[2].data.slice()] : []),
		];
		const targetSeries = [
			nextClose,
			nextEquity,
			nextAllIn,
			...(hasLeveragedBenchmark ? [nextAllInLeveraged] : []),
		];
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
			if (hasLeveragedBenchmark) {
				equityChart.data.datasets[2].data = interpolate(targetSeries[3], 3);
			}
			applyBacktestYAxisScale(
				priceChart,
				priceChart.canvas,
				[priceChart.data.datasets[0].data],
				resolvePadding(getPriceYPadding),
			);
			applyBacktestYAxisScale(
				equityChart,
				equityChart.canvas,
				[
					equityChart.data.datasets[0].data,
					equityChart.data.datasets[1].data,
					...(hasLeveragedBenchmark ? [equityChart.data.datasets[2].data] : []),
				],
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

	const prepareMount = (state, isBacktestTradeDetailsEnabled, distributionRegistry) => {
		const continuation = {};
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
		const chartTickers = Array.isArray(backtestResult.tickers)
			? backtestResult.tickers.map((ticker) => String(ticker || "").trim()).filter(Boolean)
			: [];
		const primaryTicker = chartTickers[0] || "Ticker 1";
		const leveragedTicker = chartTickers[1] || "Ticker 2";
		const isLeveragedRotationChart = backtestResult.multi_asset === true && chartTickers.length >= 2;
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
		
        const overviewHeading = priceCanvas.closest('.backtest-surface')?.querySelector('.chart-heading');
        if (overviewHeading?.textContent.trim() === 'Trade actions and net asset curve') {
            overviewHeading.textContent = 'Price and strategy analysis';
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
		const rawLeveragedAllInEquity = Array.isArray(backtestResult.chart?.all_in_leveraged_equity)
			? backtestResult.chart.all_in_leveraged_equity.map((value) => Number(value || 0))
			: [];
		const hasLeveragedBenchmark = isLeveragedRotationChart
			&& rawLeveragedAllInEquity.length === labels.length;
		const allInPrimaryReferenceColor = resolvedTheme.muted;
		const allInLeveragedReferenceColor = resolvedTheme.muted;
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
		const buildTradeMarkerPoints = (
			trades,
			dates,
			tradeInterval,
			primaryCurveValues,
		) => {
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
				const ticker = String(trade?.ticker || "").trim();
				const isLeveragedTrade = isLeveragedRotationChart && ticker === leveragedTicker;
				const executionPrice = Number(trade?.price);
				const projectedPrice = Number(primaryCurveValues?.[index]);
				const price = isLeveragedTrade ? projectedPrice : executionPrice;
				if (!Number.isInteger(index) || !Number.isFinite(price)) return accumulator;
				const side = String(trade?.side || "");
				const marker = {
					index,
					price,
					ticker,
					projectedToPrimaryCurve: isLeveragedTrade,
				};
				if (side === "Buy") accumulator.buy.push(marker);
				if (side === "Sell") accumulator.sell.push(marker);
				return accumulator;
			}, { buy: [], sell: [] });
		};
		const tradeMarkerPoints = buildTradeMarkerPoints(
			backtestResult.trades,
			rawDates,
			interval,
			close,
		);
		const allInEquity = Array.isArray(backtestResult.chart?.all_in_primary_equity)
			&& backtestResult.chart.all_in_primary_equity.length
			? backtestResult.chart.all_in_primary_equity.map((value) => Number(value || 0))
			: Array.isArray(backtestResult.chart?.all_in_equity) && backtestResult.chart.all_in_equity.length
				? backtestResult.chart.all_in_equity.map((value) => Number(value || 0))
			: buildAllInSeries(open, close, initialCapital);
		const allInLeveragedEquity = hasLeveragedBenchmark ? rawLeveragedAllInEquity : [];

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
		).trim() || getComputedStyle(document.body).fontFamily;
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
					<span class="chart-tooltip-dot" data-dot-role="close"></span>
					<span></span>
					<span class="chart-tooltip-label" data-tooltip-label="close">Close</span>
					<span class="chart-tooltip-value" data-role="close"></span>
				</div>
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot" data-dot-role="return"></span>
					<span></span>
					<span class="chart-tooltip-label">Net return</span>
					<span class="chart-tooltip-value" data-role="return"></span>
				</div>
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot" data-dot-role="equity"></span>
					<span></span>
					<span class="chart-tooltip-label">Equity</span>
					<span class="chart-tooltip-value" data-role="equity"></span>
				</div>
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot" data-dot-role="all-in-primary"></span>
					<span></span>
					<span class="chart-tooltip-label" data-tooltip-label="all-in-primary">If all in</span>
					<span class="chart-tooltip-value" data-role="all-in"></span>
				</div>
				${hasLeveragedBenchmark ? `
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot" data-dot-role="all-in-leveraged"></span>
					<span></span>
					<span class="chart-tooltip-label" data-tooltip-label="all-in-leveraged"></span>
					<span class="chart-tooltip-value" data-role="all-in-leveraged"></span>
				</div>
				` : ""}
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot" data-dot-role="vs-all-in"></span>
					<span></span>
					<span class="chart-tooltip-label" data-tooltip-label="vs-all-in">vs all in</span>
					<span class="chart-tooltip-value" data-role="vs-all-in"></span>
				</div>
			</div>
		`;
		if (hasLeveragedBenchmark) {
			tooltip.querySelector('[data-tooltip-label="close"]').textContent = `${primaryTicker} close`;
			tooltip.querySelector('[data-tooltip-label="all-in-primary"]').textContent = `All in ${primaryTicker}`;
			tooltip.querySelector('[data-tooltip-label="all-in-leveraged"]').textContent = `All in ${leveragedTicker}`;
			tooltip.querySelector('[data-tooltip-label="vs-all-in"]').textContent = `vs all in ${primaryTicker}`;
		}
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
			// The outer split grid can resolve one CSS pixel below its published
			// minimum after borders and fractional tracks are rounded. Reserve that
			// pixel so the innermost complete row is not lost at the Home position.
			const stageMinimum = Math.ceil(
				(requiredPlotHeight + chartChromeHeight) / pricePanelShare,
			) + PROBABILITY_STAGE_MINIMUM_LAYOUT_BUFFER_PX;
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
				if (!continuation.isProbabilityHoverPointerOverStack(tradeChartStack.getBoundingClientRect())) {
					continuation.updateCurveHoverLine();
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
				return formatFullDateParts(dateParts, { includeTime: interval === "1m" });
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
						if (!controllerDestroyed) continuation.scheduleProbabilityDetailRefresh();
					}).catch(() => {
						detailModuleFailed = true;
						if (!controllerDestroyed && probabilityDetailStatus) {
							probabilityDetailStatus.textContent = "Price field detail could not be loaded. Reload to retry.";
						}
					}).finally(() => { detailModulePending = false; });
				}
				return false;
			}
			const detailModel = continuation.buildProbabilityDetailModel(index, model);
			if (!detailModel) return false;
			const {geometry, cells, anchorPrice} = detailModel;
			latestProbabilityDetailModel = detailModel;
			renderProbabilityDetailSideSummary(cells);
			const anchorDate = parseRawDate(rawDates[index]);
			const selectedDate = anchorDate ? formatSelectedDate(anchorDate) : (labels[index] || "selected date");
			latestProbabilityDetailBaseStatus = `Selected date: ${selectedDate}`;
			if (detailModel.maxHorizon) {
				latestProbabilityDetailBaseStatus += ` · Direct close-price forecasts: 1–${detailModel.maxHorizon} trading days`;
				if (detailModel.priceDomain?.scaleKind === "symmetric-log-return") {
					latestProbabilityDetailBaseStatus += " · Log-price scale";
				}
			}
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
                const chartYAxisWidth = readPxToken(
                    tradeChartStack,
                    "--backtest-chart-y-axis-width",
                    72,
                );
                const plotInlineStart = readPxToken(
                    detailPlot,
                    "--backtest-probability-detail-plot-inline-start",
                    28,
                );
                const axisWidth = Math.max(0, chartYAxisWidth - plotInlineStart);
				detailPlot.style.gridTemplateColumns = `${axisWidth}px minmax(0, 1fr)`;
				detailPlot.style.removeProperty("width");
				detailPlot.style.removeProperty("align-self");
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
			probabilityDetailPanel.dataset.horizonStep = String(detailModel.horizonStep);
			probabilityDetailPanel.dataset.cellDisplayThresholdPct = String(
				detailModel.cellDisplayThresholdPct,
			);
			probabilityDetailPanel.dataset.thresholdHiddenCount = String(
				cells.filter((cell) => cell.isVisible === false).length,
			);
			probabilityDetailPanel.dataset.priceDomain = detailModel.priceDomain
				? "direct-forecast-log" : "overview-y-scale";
			probabilityDetailPanel.dataset.priceScale = detailModel.priceDomain?.scaleKind
				|| "linear-price";
			if (detailModel.priceDomain) {
				probabilityDetailPanel.dataset.priceDomainLower = String(detailModel.priceDomain.lowerPrice);
				probabilityDetailPanel.dataset.priceDomainUpper = String(detailModel.priceDomain.upperPrice);
			} else {
				delete probabilityDetailPanel.dataset.priceDomainLower;
				delete probabilityDetailPanel.dataset.priceDomainUpper;
			}
			probabilityDetailGrid.setAttribute(
				"aria-label",
				`Future price probability field for ${labels[index] || "selected date"}; displayed from the signal-close anchor; executable target is next-open to-following-open`
					+ (detailModel.priceDomain?.scaleKind === "symmetric-log-return"
						? "; logarithmic price scale" : ""),
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
            probabilityDetailGrid.dataset.horizonStep = String(detailModel.horizonStep);
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
				priceScale: detailModel.priceDomain?.scaleKind === "symmetric-log-return"
					? "log" : "linear",
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
            let observedSvg = detailGridViewport.querySelector('[data-backtest-probability-detail-observed]');
            if (!observedSvg) {
                observedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                observedSvg.classList.add('backtest-probability-detail-observed');
                observedSvg.dataset.backtestProbabilityDetailObserved = '';
                observedSvg.setAttribute('role', 'img');
                observedSvg.setAttribute('aria-label', 'Observed prices after the selected date');
                for (const side of ['up', 'down']) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.classList.add(`is-${side}`);
                    observedSvg.appendChild(path);
                }
                detailGridViewport.appendChild(observedSvg);
            }
            const observedEnd = Math.min(close.length - 1, rawDates.length - 1, index + finalHorizon);
            const observedPrices = close.slice(index, observedEnd + 1);
            const observedPaths = window.WORTHWARD_PRICE_FIELD_DETAIL_CHART.buildObservedPaths(
                observedPrices, layout, anchorPrice, finalHorizon, geometry.columnCount,
            );
            observedSvg.setAttribute('viewBox', `0 0 ${detailGridViewportWidth} ${detailGridViewportHeight}`);
            observedSvg.dataset.endDate = rawDates[observedEnd] || '';
            observedSvg.dataset.pointCount = String(observedPrices.length);
            observedSvg.querySelector('.is-up').setAttribute('d', observedPaths.up);
            observedSvg.querySelector('.is-down').setAttribute('d', observedPaths.down);
			probabilityDetailYAxis.replaceChildren();
			for (let tickIndex = 0; tickIndex < 5; tickIndex += 1) {
				const tick = document.createElement("span");
				const price = layout.yToPrice(detailGridViewportHeight * tickIndex / 4);
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

		return {
			continuation,
			BACKTEST_HISTORY_VIEW_CHANGE_EVENT,
			PROBABILITY_MODEL_CACHE_LIMIT,
			PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT,
			get activeIndex() { return activeIndex; },
			set activeIndex(value) { activeIndex = value; },
			get activePriceOverlay() { return activePriceOverlay; },
			set activePriceOverlay(value) { activePriceOverlay = value; },
			get activeSourceCanvas() { return activeSourceCanvas; },
			set activeSourceCanvas(value) { activeSourceCanvas = value; },
			get activeSourceChart() { return activeSourceChart; },
			set activeSourceChart(value) { activeSourceChart = value; },
			allInEquity,
			allInLeveragedEquity,
			allInLeveragedReferenceColor,
			allInPrimaryReferenceColor,
			animateBacktestRefreshTransition,
			applyBacktestYAxisScale,
			applyProbabilityCellNode,
			backtestResult,
			bindColorSchemeRefresh,
			bootstrap,
			buildAlignedSeries,
			buildPixelPaddedYScale,
			buildTickIndexSet,
			cancelControllerAnimationFrame,
			chartAxis,
			chartAxisCanvasFont,
			chartAxisFontFamily,
			chartAxisFontSize,
			chartAxisFontWeight,
			chartAxisLineHeight,
			chartHoverPointCaches,
			chartYPaddingPx,
			clearProbabilityStageMinimum,
			close,
			consumeBacktestRefreshTransition,
			controllerAnimationFrames,
			get controllerDestroyed() { return controllerDestroyed; },
			set controllerDestroyed(value) { controllerDestroyed = value; },
			controllerTaskCleanups,
			distribution,
			documentController,
			drawProbabilityCanvas,
			equity,
			equityCanvas,
			get equityChart() { return equityChart; },
			set equityChart(value) { equityChart = value; },
			fixedPriceAxis,
			fixedYAxisWidth,
			formatBacktestYAxisTick,
			formatChartDate,
			formatChartDateLines,
			formatMoney,
			formatReturn,
			formatStockPriceAxisValue,
			formatTradeMarkerDateKey,
			getChartHoverPointCache,
			getProbabilityHoverLayout,
			hasLeveragedBenchmark,
			hideHoverDateLabel,
			hideProbabilityDetail,
			high,
			hoverCrosshairLine,
			hoverDateLabel,
			get hoverFrameId() { return hoverFrameId; },
			set hoverFrameId(value) { hoverFrameId = value; },
			hoverLine,
			initialCapital,
			interval,
			isBacktestTradeDetailsEnabled,
			isCandlestick,
			isProbabilityAuxiliarySurface,
			isProbabilityHistoryViewActive,
			isSessionGap,
			get isUpdatingProbabilityFieldPosition() { return isUpdatingProbabilityFieldPosition; },
			set isUpdatingProbabilityFieldPosition(value) { isUpdatingProbabilityFieldPosition = value; },
			labels,
			get latestProbabilityDetailIndex() { return latestProbabilityDetailIndex; },
			set latestProbabilityDetailIndex(value) { latestProbabilityDetailIndex = value; },
			get layoutFrameId() { return layoutFrameId; },
			set layoutFrameId(value) { layoutFrameId = value; },
			leveragedTicker,
			low,
			open,
			parseRawDate,
			get pendingHoverUpdate() { return pendingHoverUpdate; },
			set pendingHoverUpdate(value) { pendingHoverUpdate = value; },
			get pinState() { return pinState; },
			set pinState(value) { pinState = value; },
			get pointerHoverFrameId() { return pointerHoverFrameId; },
			set pointerHoverFrameId(value) { pointerHoverFrameId = value; },
			priceCanvas,
			get priceChart() { return priceChart; },
			set priceChart(value) { priceChart = value; },
			get priceChartYPadding() { return priceChartYPadding; },
			set priceChartYPadding(value) { priceChartYPadding = value; },
			primaryTicker,
			probabilityDetailGrid,
			get probabilityDetailLayoutObserver() { return probabilityDetailLayoutObserver; },
			set probabilityDetailLayoutObserver(value) { probabilityDetailLayoutObserver = value; },
			probabilityDetailPanel,
			get probabilityDetailRefreshFrameId() { return probabilityDetailRefreshFrameId; },
			set probabilityDetailRefreshFrameId(value) { probabilityDetailRefreshFrameId = value; },
			get probabilityDetailRefreshPasses() { return probabilityDetailRefreshPasses; },
			set probabilityDetailRefreshPasses(value) { probabilityDetailRefreshPasses = value; },
			get probabilityFieldPositionUpdater() { return probabilityFieldPositionUpdater; },
			set probabilityFieldPositionUpdater(value) { probabilityFieldPositionUpdater = value; },
			probabilityGridApi,
			probabilityHint,
			get probabilityHoverIntersection() { return probabilityHoverIntersection; },
			set probabilityHoverIntersection(value) { probabilityHoverIntersection = value; },
			get probabilityHoverLayout() { return probabilityHoverLayout; },
			set probabilityHoverLayout(value) { probabilityHoverLayout = value; },
			get probabilityHoverPointerActive() { return probabilityHoverPointerActive; },
			set probabilityHoverPointerActive(value) { probabilityHoverPointerActive = value; },
			get probabilityHoverPointerX() { return probabilityHoverPointerX; },
			set probabilityHoverPointerX(value) { probabilityHoverPointerX = value; },
			get probabilityHoverPointerY() { return probabilityHoverPointerY; },
			set probabilityHoverPointerY(value) { probabilityHoverPointerY = value; },
			get probabilityManualPanOffset() { return probabilityManualPanOffset; },
			set probabilityManualPanOffset(value) { probabilityManualPanOffset = value; },
			probabilityModelCache,
			get probabilityPanGesture() { return probabilityPanGesture; },
			set probabilityPanGesture(value) { probabilityPanGesture = value; },
			get probabilityScrollCleanup() { return probabilityScrollCleanup; },
			set probabilityScrollCleanup(value) { probabilityScrollCleanup = value; },
			get probabilityScrollLastTimestamp() { return probabilityScrollLastTimestamp; },
			set probabilityScrollLastTimestamp(value) { probabilityScrollLastTimestamp = value; },
			probabilityScrollPort,
			get probabilityScrollPortWidth() { return probabilityScrollPortWidth; },
			set probabilityScrollPortWidth(value) { probabilityScrollPortWidth = value; },
			probabilityScrollResizer,
			probabilityScrollSpacer,
			get probabilityScrollStackWidth() { return probabilityScrollStackWidth; },
			set probabilityScrollStackWidth(value) { probabilityScrollStackWidth = value; },
			get probabilityScrollTarget() { return probabilityScrollTarget; },
			set probabilityScrollTarget(value) { probabilityScrollTarget = value; },
			get probabilityScrollVelocity() { return probabilityScrollVelocity; },
			set probabilityScrollVelocity(value) { probabilityScrollVelocity = value; },
			get probabilityScrollVisualPosition() { return probabilityScrollVisualPosition; },
			set probabilityScrollVisualPosition(value) { probabilityScrollVisualPosition = value; },
			probabilityTooltip,
			publishProbabilityStageMinimum,
			rawDates,
			readPxToken,
			readThemeTokens,
			renderProbabilityDetail,
			requestControllerAnimationFrame,
			resetProbabilityHoverPointer,
			resolvedTheme,
			resultsStack,
			setInlineStyleIfChanged,
			setProbabilityScrollExtent,
			setProbabilityScrollPortActive,
			setProbabilityScrollPosition,
			setProbabilityScrollTarget,
			snapProbabilityScrollToFit,
			get strategyPresentation() { return strategyPresentation; },
			set strategyPresentation(value) { strategyPresentation = value; },
			svgMarkerPath,
			svgMarkerTip,
			svgMarkerViewBox,
			get themeCleanup() { return themeCleanup; },
			set themeCleanup(value) { themeCleanup = value; },
			tooltip,
			tradeChartStack,
			tradeMarkerPoints,
			updateHoverDateLabel,
		};
	};

	globalScope.WORTHWARD_BACKTEST_CHART_CONTROLLER_MOUNT = Object.freeze({prepareMount});
})(typeof globalThis !== "undefined" ? globalThis : window);
