/* Code version: v1.12.2 */
/**
 * Preserves the public Backtest chart-controller contract while delegating
 * mount preparation to the preceding classic-script helper.
 */
(function bootstrapBacktestChartController(globalScope) {
	"use strict";
	const mountSupport = globalScope.WORTHWARD_BACKTEST_CHART_CONTROLLER_MOUNT;
	if (typeof mountSupport?.prepareMount !== "function") {
		throw new Error("Backtest chart-controller mount helper is unavailable.");
	}

	const mountCharts = (state, isBacktestTradeDetailsEnabled, distributionRegistry) => {
		const mount = mountSupport.prepareMount(
			state,
			isBacktestTradeDetailsEnabled,
			distributionRegistry,
		);
		if (!mount) return null;
		const {continuation} = mount;

		const xAxisLabelPlugin = {
			id: "tradeXAxisLabelPlugin",
			afterDraw(chart) {
				const xAxisCanvas = mount.isBacktestTradeDetailsEnabled() ? mount.equityCanvas : mount.priceCanvas;
				if (chart.canvas !== xAxisCanvas) return;
				const { ctx, chartArea, scales } = chart;
				const xScale = scales?.x;
				if (!chartArea || !xScale || !mount.labels.length) return;
				const viewportWidth = mount.tradeChartStack?.clientWidth || chart.canvas?.clientWidth || window.innerWidth || document.documentElement.clientWidth || 0;
				const tickIndexes = Array.from(mount.buildTickIndexSet(mount.labels.length, viewportWidth)).sort((left, right) => left - right);
				const baselineY = chartArea.bottom;
				const lineHeight = mount.chartAxisLineHeight;
				ctx.save();
				ctx.fillStyle = mount.resolvedTheme.muted;
				ctx.font = mount.chartAxisCanvasFont;
				ctx.textBaseline = "top";
				tickIndexes.forEach((index, tickIndex) => {
					const parsedDate = mount.parseRawDate(mount.rawDates[index]);
					if (!parsedDate) return;
					const [firstLine, secondLine] = mount.formatChartDateLines(parsedDate);
					const x = xScale.getPixelForValue(index);
					if (!Number.isFinite(x)) return;
					if (tickIndex === 0) ctx.textAlign = "left";
					else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = "right";
					else ctx.textAlign = "center";
					if (mount.strategyPresentation && mount.activePriceOverlay && !mount.hoverDateLabel.hidden) {
						const width = Math.max(ctx.measureText(firstLine).width, ctx.measureText(secondLine).width);
						const left = x - (ctx.textAlign === "right" ? width : ctx.textAlign === "center" ? width / 2 : 0);
						const badgeX = Number.parseFloat(mount.hoverDateLabel.style.left) - getStaticStackContentLeft(chart.canvas);
						const halfBadge = mount.hoverDateLabel.offsetWidth / 2;
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
				if (!mount.isCandlestick || chart.canvas !== mount.priceCanvas) return;
				const { ctx, chartArea, data, scales } = chart;
				const meta = chart.getDatasetMeta(0);
				const xScale = scales.x;
				const yScale = scales.y;
				if (!meta || !meta.data.length) return;

				const columnWidth = (chartArea.right - chartArea.left) / mount.labels.length;
				const candleWidth = Math.min(20, Math.max(1.5, columnWidth * 0.72));
				const wickWidth = 1;

				ctx.save();
				meta.data.forEach((point, i) => {
					const o = mount.open[i];
					const h = mount.high[i];
					const l = mount.low[i];
					const c = mount.close[i];
					if (!Number.isFinite(o) || !Number.isFinite(c)) return;

					const x = point.x;
					const openY = yScale.getPixelForValue(o);
					const highY = yScale.getPixelForValue(h);
					const lowY = yScale.getPixelForValue(l);
					const closeY = yScale.getPixelForValue(c);
					
					const color = mount.resolvedTheme.accentPrimary;
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
				if (!mount.isBacktestTradeDetailsEnabled() || chart.canvas !== mount.priceCanvas) return;
				const yScale = chart.scales?.y;
				const priceMeta = chart.getDatasetMeta(0);
				if (!yScale || !priceMeta?.data?.length) return;

				const drawMarker = (marker, direction, color) => {
					const point = priceMeta.data[marker.index];
					const y = yScale.getPixelForValue(marker.price);
					if (!point || !Number.isFinite(point.x) || !Number.isFinite(y)) return;
					const sizePx = 8;
					const scale = sizePx / mount.svgMarkerViewBox.width;
					const tip = mount.svgMarkerTip[direction];
					const path = mount.svgMarkerPath[direction];
					chart.ctx.save();
					chart.ctx.fillStyle = color;
					chart.ctx.translate(point.x, y);
					chart.ctx.scale(scale, scale);
					chart.ctx.translate(-tip.x, -tip.y);
					chart.ctx.fill(path);
					chart.ctx.restore();
				};

				mount.tradeMarkerPoints.buy.forEach((marker) => drawMarker(marker, "up", mount.resolvedTheme.accentPositive));
				mount.tradeMarkerPoints.sell.forEach((marker) => drawMarker(marker, "down", mount.resolvedTheme.accentSecondary));
			},
		};

		const priceHoverOverlayPlugin = {
			id: "backtestPriceHoverOverlayPlugin",
			beforeDatasetsDraw(chart) {
				if (chart.canvas !== mount.priceCanvas || !mount.activePriceOverlay || !Number.isInteger(mount.activeIndex)) {
					chart._activeBacktestPriceGuideBounds = null;
					return;
				}
				const point = chart.getDatasetMeta(0)?.data?.[mount.activeIndex];
				const {ctx, chartArea, scales} = chart;
				const yScale = scales?.y;
				if (!point || !chartArea || !yScale || !Number.isFinite(point.y)) return;
				let guideX = point.x;
				let guideY = point.y;
				let price = Number(mount.close[mount.activeIndex]);
				let contentX = null;
				if (
					mount.strategyPresentation
					&& mount.pinState.mode !== "pinned"
					&& isProbabilityHoverPointerOverStack(mount.tradeChartStack.getBoundingClientRect())
				) {
					const guide = getProbabilityHoverGuide(mount.tradeChartStack.getBoundingClientRect());
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
					index: mount.activeIndex,
					left: chartArea.left,
					price,
					right: chartArea.right,
					x: guideX,
					y: guideY,
					...(Number.isFinite(contentX) ? {contentX} : {}),
				};
				if (mount.strategyPresentation) return;
				const mutedSoft = getComputedStyle(document.body).getPropertyValue("--theme-muted-soft").trim()
					|| mount.resolvedTheme.muted;
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
				if (mount.strategyPresentation) return;
				const bounds = chart._activeBacktestPriceGuideBounds;
				if (!bounds || typeof mount.chartAxis.drawYAxisValueBadge !== "function") return;
				const formattedPrice = new Intl.NumberFormat("en-US", {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				}).format(bounds.price);
				mount.chartAxis.drawYAxisValueBadge(chart, {
					y: bounds.y,
					value: bounds.price,
					formattedValue: formattedPrice,
					formatTickLabel: mount.formatStockPriceAxisValue,
					fillColor: mount.resolvedTheme.accentPrimary,
					boundsProperty: "_activeBacktestPriceGuideBounds",
					boundsAliases: {formattedPrice, price: bounds.price},
				});
			},
			afterDraw(chart) {
				if (!mount.fixedPriceAxis || chart.canvas !== mount.priceCanvas || !chart.chartArea) return;
				const ratio = chart.currentDevicePixelRatio || 1;
				const width = Math.ceil(chart.chartArea.left + 48);
				const height = chart.height;
				if (mount.fixedPriceAxis.width !== Math.ceil(width * ratio)) mount.fixedPriceAxis.width = Math.ceil(width * ratio);
				if (mount.fixedPriceAxis.height !== Math.ceil(height * ratio)) mount.fixedPriceAxis.height = Math.ceil(height * ratio);
				mount.setInlineStyleIfChanged(mount.fixedPriceAxis, "width", `${width}px`);
				mount.setInlineStyleIfChanged(mount.fixedPriceAxis, "height", `${height}px`);
				mount.setInlineStyleIfChanged(mount.fixedPriceAxis, "top", `${mount.priceCanvas.offsetTop}px`);
				const ctx = mount.fixedPriceAxis.getContext("2d");
				ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
				ctx.clearRect(0, 0, width, height);
				// Composite the actual translucent surface over its ancestors. Using
				// only the body color creates a visibly different strip in dark mode.
				ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--theme-background").trim() || "#ffffff";
				ctx.fillRect(0, 0, chart.chartArea.left, height);
				const backgrounds = [];
				for (let node = mount.priceCanvas.parentElement; node; node = node.parentElement) {
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
					const badge = mount.chartAxis.drawYAxisValueBadge?.({...chart, ctx}, {
						y: bounds.y, value: bounds.price, formattedValue: mount.formatMoney(bounds.price),
						formatTickLabel: mount.formatStockPriceAxisValue, fillColor: mount.resolvedTheme.accentPrimary,
					});
					if (badge) Object.assign(bounds, badge, {formattedPrice: mount.formatMoney(bounds.price)});
				}
			},
		};

		const buildYAxisTicks = (fractionDigits, valueFormatter = null) => ({
				color: mount.resolvedTheme.muted,
				font: {
					family: mount.chartAxisFontFamily,
					size: mount.chartAxisFontSize,
					weight: mount.chartAxisFontWeight,
				},
				display: true,
			padding: 8,
			callback(value, index, ticks) {
				return mount.formatBacktestYAxisTick(value, index, ticks, fractionDigits, valueFormatter);
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
						scale.width = mount.fixedYAxisWidth;
					},
					ticks: buildYAxisTicks(0),
				},
			},
		};

		const updateHoverLineFrame = () => {
			if (!mount.priceChart?.chartArea) return null;
			const showTradeDetails = mount.isBacktestTradeDetailsEnabled();
			if (showTradeDetails && !mount.equityChart?.chartArea) return null;
			const priceCanvasRect = mount.priceCanvas.getBoundingClientRect();
			const stackRect = mount.tradeChartStack.getBoundingClientRect();
			const top = priceCanvasRect.top - stackRect.top + mount.priceChart.chartArea.top;
			const bottomCanvas = showTradeDetails ? mount.equityCanvas : mount.priceCanvas;
			const bottomChart = showTradeDetails ? mount.equityChart : mount.priceChart;
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
			while (current instanceof HTMLElement && current !== mount.tradeChartStack) {
				contentLeft += Number(current.offsetLeft) || 0;
				current = current.offsetParent;
			}
			return current === mount.tradeChartStack && Number.isFinite(contentLeft)
				? contentLeft
				: null;
		};
		const getPriceCanvasContentLeft = () => getStaticStackContentLeft(mount.priceCanvas);
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
			if (!mount.priceChart?.width || !mount.priceChart?.height) return null;
			const pointCache = mount.getChartHoverPointCache(mount.priceChart);
			const finitePoints = pointCache.finitePoints;
			if (!finitePoints.length) return null;
			const canvasRect = mount.priceCanvas.getBoundingClientRect();
			const currentStackRect = stackRect || mount.tradeChartStack.getBoundingClientRect();
			const scaleX = canvasRect.width / Number(mount.priceChart.width);
			const scaleY = canvasRect.height / Number(mount.priceChart.height);
			if (!(scaleX > 0) || !(scaleY > 0)) return null;
			// Recover unscrolled content origin from the live canvas rect so the
			// selected date matches the visible curve point, including after pan.
			const canvasContentLeft = (canvasRect.left - currentStackRect.left)
				+ mount.probabilityScrollVisualPosition;
			if (!Number.isFinite(canvasContentLeft)) return null;
			const firstPoint = finitePoints[0];
			const lastPoint = finitePoints[finitePoints.length - 1];
			const firstContentX = canvasContentLeft + (firstPoint.x * scaleX);
			const lastContentX = canvasContentLeft + (lastPoint.x * scaleX);
			// Intersect the visible, already-panned curve directly below the cursor.
			const pointerContentX = Number(stackRelativeX) + mount.probabilityScrollVisualPosition;
			if (!Number.isFinite(pointerContentX)) return null;
			const contentX = Math.min(
				lastContentX,
				Math.max(firstContentX, pointerContentX),
			);
			const clampedChartX = (contentX - canvasContentLeft) / scaleX;
			const intersection = mount.probabilityGridApi.intersectPolylineAtX?.(
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
			if (!chartArea || !mount.labels.length) return null;
			const canvasRect = chart.canvas.getBoundingClientRect();
			const isProbabilityPriceHover = chart.canvas === mount.priceCanvas && mount.strategyPresentation;
			const interactionRect = isProbabilityPriceHover
				? mount.tradeChartStack.getBoundingClientRect()
				: canvasRect;
			const relativeX = event.clientX - interactionRect.left;
			if (isProbabilityPriceHover) {
				mount.probabilityHoverPointerX = Number(event.clientX);
				mount.probabilityHoverPointerY = Number(event.clientY);
				mount.probabilityHoverPointerActive = true;
			}
			const relativeY = event.clientY - canvasRect.top;
			if (!Number.isFinite(relativeX)) return null;
			const pointCache = mount.getChartHoverPointCache(chart);
			const {points, finitePoints} = pointCache;
			if (!finitePoints.length) return null;
			let hoverRelativeX = relativeX;
			if (isProbabilityPriceHover) {
				// Include the current overflow pan so the selected origin is the
				// visible curve point under the vertical guide, not a lagged
				// date from unscrolled content space.
				const resolved = resolveProbabilityPointerIntersection(relativeX, interactionRect);
				if (!resolved) {
					mount.resetProbabilityHoverPointer();
					return null;
				}
				mount.probabilityHoverIntersection = resolved.intersection;
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
			if (chart.canvas !== mount.priceCanvas || !Number.isFinite(relativeY)) return nearestIndex;
			if (relativeY < chartArea.top || relativeY >= chartArea.bottom) return nearestIndex;
			if (mount.strategyPresentation) return nearestIndex;

			const yScale = chart.scales?.y;
			if (!yScale) return nearestIndex;

			const markerCandidates = mount.isBacktestTradeDetailsEnabled()
				? [...mount.tradeMarkerPoints.buy, ...mount.tradeMarkerPoints.sell]
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
			if (mount.probabilityHint) mount.probabilityHint.hidden = true;
			mount.tradeChartStack.classList.remove("has-probability-overflow");
			mount.resetProbabilityHoverPointer();
			mount.hideHoverDateLabel();
			mount.probabilityTooltip?.classList.remove("is-visible");
			if (mount.probabilityTooltip) {
				mount.probabilityTooltip.hidden = true;
				mount.probabilityTooltip.dataset.pinned = mount.pinState.mode === "pinned" ? "true" : "false";
			}
			if (mount.priceChart) mount.priceChart._activeBacktestProbabilityGridBounds = null;
			if (immediate) mount.snapProbabilityScrollToFit();
			else mount.setProbabilityScrollTarget(0);
		};

		const buildProbabilityGridModel = (index, pricePoint) => {
			if (!mount.strategyPresentation || !mount.priceChart?.chartArea || !mount.priceChart?.scales?.y || !pricePoint) {
				return null;
			}
			const hoverLayout = mount.getProbabilityHoverLayout();
			if (!hoverLayout) return null;
			const cachedModel = mount.probabilityModelCache.get(index);
			if (cachedModel?.cacheKey?.startsWith(`${hoverLayout.signature}|${index}`)) {
				mount.probabilityModelCache.delete(index);
				mount.probabilityModelCache.set(index, cachedModel);
				return cachedModel;
			}
			const meanValue = mount.strategyPresentation.predictive_mean?.[index];
			const scaleValue = mount.strategyPresentation.predictive_scale?.[index];
			const autoregressionValue = mount.strategyPresentation.return_autoregression?.[index];
			const longRunMeanValue = mount.strategyPresentation.return_long_run_mean?.[index];
			const innovationScaleValue = mount.strategyPresentation.return_innovation_scale?.[index];
			const mean = Number(meanValue);
			const scale = Number(scaleValue);
			const autoregression = Number(autoregressionValue);
			const longRunMean = Number(longRunMeanValue);
			const innovationScale = Number(innovationScaleValue);
			const horizonMean = mount.strategyPresentation.horizon_predictive_mean?.[index];
			const horizonStd = mount.strategyPresentation.horizon_predictive_std?.[index];
			const maxHorizon = mount.strategyPresentation.distribution_kind === "direct-normal-horizon"
				? mount.strategyPresentation.max_horizon : null;
			const anchorPrice = Number(mount.close[index]);
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
			const geometry = mount.probabilityGridApi.computeGridGeometry?.({
				chartArea: mount.priceChart.chartArea,
				anchorX: pricePoint.x,
				anchorY: pricePoint.y,
				columnCount: mount.strategyPresentation.columns,
				widthFraction: mount.strategyPresentation.width_fraction,
				gapPx: mount.strategyPresentation.gap_px,
				paddingPx: mount.strategyPresentation.padding_px,
				minCellPx: mount.strategyPresentation.min_cell_px,
				rowsAbove: mount.strategyPresentation.rows_above,
				rowsBelow: mount.strategyPresentation.rows_below,
				stepPixels,
				cellSizeTargetPx,
			});
			if (!geometry) return null;
			// Direct models own one learned distribution per forecast horizon. Keep
			// that semantic axis independent from the wider square-cell spacing
			// required to keep the overview legible on dense history charts.
			const horizonStep = Number.isInteger(maxHorizon) ? 1 : geometry.daysPerColumn;
			const cells = mount.probabilityGridApi.buildProbabilityCells?.({
				distribution: mount.distribution,
				geometry,
				anchorPrice,
				mean,
				scale,
				autoregression,
				longRunMean,
				innovationScale,
				horizonMean,
				horizonStd,
				maxHorizon,
				horizonStep,
				stepPixels,
				valueForPixel: (pixel) => mount.priceChart.scales.y.getValueForPixel(pixel),
				opacityExponent: mount.strategyPresentation.cell_opacity_exponent,
				opacityTailRatio: mount.strategyPresentation.cell_opacity_tail_ratio,
				cellDisplayThresholdPct: mount.strategyPresentation.cell_display_threshold_pct,
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
				horizonMean,
				horizonStd,
				maxHorizon,
				horizonStep,
				stepPixels,
				cellDisplayThresholdPct: mount.strategyPresentation.cell_display_threshold_pct,
			};
			mount.probabilityModelCache.set(index, model);
			while (mount.probabilityModelCache.size > mount.PROBABILITY_MODEL_CACHE_LIMIT) {
				mount.probabilityModelCache.delete(mount.probabilityModelCache.keys().next().value);
			}
			return model;
		};
		const buildProbabilityHoverModel = (index, model, pricePoint) => {
			if (!model?.geometry || !pricePoint || !mount.priceChart?.scales?.y) return model;
			const intersection = mount.pinState.mode !== "pinned" ? mount.probabilityHoverIntersection : null;
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
			if (!mount.strategyPresentation || !model?.geometry || !mount.priceChart?.chartArea
				|| !mount.priceChart?.scales?.y) return null;
			const nativeGeometry = mount.probabilityGridApi.computeGridGeometry?.({
				chartArea: mount.priceChart.chartArea,
				anchorX: model.geometry.anchorX,
				anchorY: model.geometry.anchorY,
				columnCount: mount.strategyPresentation.columns,
				widthFraction: mount.strategyPresentation.width_fraction,
				gapPx: mount.strategyPresentation.gap_px,
				paddingPx: mount.strategyPresentation.padding_px,
				minCellPx: mount.strategyPresentation.min_cell_px,
				rowsAbove: mount.strategyPresentation.rows_above,
				rowsBelow: mount.strategyPresentation.rows_below,
				stepPixels: model.stepPixels,
				cellSizeTargetPx: model.geometry.cellSize,
				limitRowsToChartArea: false,
			});
			// The contained field owns its forecast-day axis. Direct models reuse
			// the same one-horizon semantic step as the overview while retaining
			// independent complete-row geometry.
			const geometry = nativeGeometry;
			if (!geometry) return null;
			const historyStart = Math.max(0, index - Number(model.maxHorizon || 0));
			const detailPriceDomain = Number.isInteger(model.maxHorizon)
				? window.WORTHWARD_PRICE_FIELD_DETAIL_CHART?.computeDirectForecastPriceDomain?.({
					anchorPrice: model.anchorPrice,
					history: mount.close.slice(historyStart, index + 1),
					horizonMean: model.horizonMean,
					horizonStd: model.horizonStd,
				})
				: null;
			const cells = mount.probabilityGridApi.buildProbabilityCells?.({
				distribution: mount.distribution,
				geometry,
				anchorPrice: model.anchorPrice,
				mean: model.mean,
				scale: model.scale,
				autoregression: model.autoregression,
				longRunMean: model.longRunMean,
				innovationScale: model.innovationScale,
				horizonMean: model.horizonMean,
				horizonStd: model.horizonStd,
				maxHorizon: model.maxHorizon,
				horizonStep: model.horizonStep,
				stepPixels: model.stepPixels,
				valueForPixel: (pixel) => mount.priceChart.scales.y.getValueForPixel(pixel),
				priceDomain: detailPriceDomain,
				opacityExponent: mount.strategyPresentation.cell_opacity_exponent,
				opacityTailRatio: mount.strategyPresentation.cell_opacity_tail_ratio,
				cellDisplayThresholdPct: mount.strategyPresentation.cell_display_threshold_pct,
			}) || [];
			if (!cells.length) return null;
			return {
				...model,
				cacheKey: `${model.cacheKey}|detail|${geometry.rowsAbove}|${geometry.rowsBelow}`
					+ `|${detailPriceDomain?.lowerPrice || "live"}|${detailPriceDomain?.upperPrice || "live"}`,
				cells,
				geometry,
				priceDomain: detailPriceDomain,
			};
		};

		const renderProbabilityTooltip = (index, stackRect, pricePoint) => {
			if (!mount.probabilityTooltip || !mount.priceChart?.chartArea || !mount.priceChart?.scales?.y || !pricePoint) {
				hideProbabilityTooltip();
				return false;
			}
			const baseModel = buildProbabilityGridModel(index, pricePoint);
			if (!baseModel) {
				hideProbabilityTooltip();
				mount.hideProbabilityDetail();
				return false;
			}
			const model = buildProbabilityHoverModel(index, baseModel, pricePoint);
			const {anchorPrice, cells, geometry, mean, scale, stepPixels} = model;
			mount.latestProbabilityDetailIndex = index;
			if (mount.isProbabilityHistoryViewActive()) {
				if (!mount.renderProbabilityDetail(index, baseModel)) {
                    // A chart resize or history-panel transition can leave the
                    // detail viewport at zero for one frame. Retry after the
                    // layout settles so the detail grid cannot retain the
                    // previous presentation (for example, an old threshold).
                    scheduleProbabilityDetailRefresh(3);
                }
            }
			mount.probabilityScrollStackWidth = Math.max(0, Number(stackRect.width) || 0);
			if (mount.probabilityScrollPort instanceof HTMLElement) {
				mount.probabilityScrollPortWidth = Math.max(
					0,
					Number(mount.probabilityScrollPort.clientWidth) || mount.probabilityScrollStackWidth,
				);
			}
			mount.setProbabilityScrollExtent(mount.probabilityScrollVisualPosition);

			const grid = mount.probabilityTooltip.querySelector("[data-backtest-probability-grid]");
			if (!(grid instanceof HTMLElement)) {
				hideProbabilityTooltip();
				return false;
			}
			mount.drawProbabilityCanvas(geometry, cells);
			const canReuseCells = grid.childElementCount === cells.length
				&& Number(grid.dataset.columnCount) === geometry.columnCount
				&& Number(grid.dataset.rowCount) === geometry.rowCount;
			const renderKey = model.cacheKey || String(index);
			const hasDomMirror = Boolean(grid.dataset.renderKey);
			const shouldUpdateDomMirror = !hasDomMirror
				|| mount.isProbabilityHistoryViewActive()
				|| mount.pinState.mode === "pinned";
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
				cells.forEach((cell, cellIndex) => mount.applyProbabilityCellNode(
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
			if (shouldUpdateDomMirror && grid.dataset.horizonStep !== String(baseModel.horizonStep)) {
				grid.dataset.horizonStep = String(baseModel.horizonStep);
			}
			if (shouldUpdateDomMirror && grid.dataset.rowCount !== String(geometry.rowCount)) {
				grid.dataset.rowCount = String(geometry.rowCount);
			}
			if (shouldUpdateDomMirror && gridLayoutChanged) {
				grid.dataset.layoutKey = gridLayoutKey;
				mount.setInlineStyleIfChanged(
					grid,
					"grid-template-columns",
					`repeat(${geometry.columnCount}, ${geometry.cellSize}px)`,
				);
				mount.setInlineStyleIfChanged(
					grid,
					"grid-template-rows",
					`repeat(${geometry.rowCount}, ${geometry.cellSize}px)`,
				);
				mount.setInlineStyleIfChanged(grid, "gap", `${geometry.gap}px`);
				mount.setInlineStyleIfChanged(
					grid,
					"padding",
					`${geometry.gridPaddingTop}px ${geometry.padding}px ${geometry.gridPaddingBottom}px ${geometry.gridPaddingInlineStart}px`,
				);
			}

			const canvasRect = mount.priceCanvas.getBoundingClientRect();
			const canvasOffsetX = getPriceCanvasContentLeft();
			if (!Number.isFinite(canvasOffsetX)) {
				hideProbabilityTooltip();
				return false;
			}
			const canvasOffsetY = canvasRect.top - stackRect.top;
			mount.setInlineStyleIfChanged(mount.probabilityTooltip, "width", `${geometry.width}px`);
			mount.setInlineStyleIfChanged(mount.probabilityTooltip, "height", `${geometry.height}px`);
			mount.probabilityTooltip.dataset.direction = geometry.direction;
			mount.probabilityTooltip.dataset.pinned = mount.pinState.mode === "pinned" ? "true" : "false";
			mount.probabilityTooltip.hidden = false;
			const fieldPosition = syncProbabilityFieldVisualPosition(
				stackRect,
				geometry,
			);
			if (!fieldPosition) {
				hideProbabilityTooltip();
				return false;
			}
			const upProbability = mount.distribution.probabilityAboveAnchor({...baseModel, horizon: 1});
			const forecastDescription = baseModel.maxHorizon
				? `signal-close to future-close forecasts; learned horizons 1–${baseModel.maxHorizon} trading days; later horizons unavailable`
				: "displayed from the signal-close anchor; executable target is next-open to-following-open";
			mount.probabilityTooltip.setAttribute(
				"aria-label",
				`${mount.labels[index] || "Selected date"}, ${mount.formatMoney(baseModel.anchorPrice)}, ${(upProbability * 100).toFixed(1)}% probability field; ${forecastDescription}`,
			);
			mount.probabilityTooltip.classList.add("is-visible");
			mount.priceChart._activeBacktestProbabilityGridBounds = {
				...geometry,
				canvasOffsetX,
				canvasOffsetY,
				displayLeft: fieldPosition.left,
				pointerAnchored: fieldPosition.pointerAnchored,
				index,
				intersectionX: mount.pinState.mode !== "pinned"
					&& Number.isFinite(mount.probabilityHoverIntersection?.x)
					? mount.probabilityHoverIntersection.x
					: pricePoint.x,
				intersectionY: mount.pinState.mode !== "pinned"
					&& Number.isFinite(mount.probabilityHoverIntersection?.y)
					? mount.probabilityHoverIntersection.y
					: pricePoint.y,
				maxProbability: Math.max(...cells.map((cell) => cell.probability)),
				minProbability: Math.min(...cells.map((cell) => cell.probability)),
				maxOpacity: Math.max(...cells.map((cell) => cell.opacity)),
				minOpacity: Math.min(...cells.map((cell) => cell.opacity)),
				cellOpacityMapping: mount.strategyPresentation.cell_opacity_mapping,
				cellOpacityExponent: mount.strategyPresentation.cell_opacity_exponent,
				cellOpacityTailRatio: mount.strategyPresentation.cell_opacity_tail_ratio,
				cellDisplayThresholdPct: mount.strategyPresentation.cell_display_threshold_pct,
				thresholdHiddenCount: cells.filter((cell) => cell.isVisible === false).length,
				daysPerColumn: geometry.daysPerColumn,
				horizonStep: baseModel.horizonStep,
				slotWidth: geometry.slotWidth,
				stepPixels,
				targetScrollLeft: mount.probabilityScrollTarget,
			};
			return true;
		};
		const refreshActiveProbabilityDetail = () => {
			if (!mount.isProbabilityHistoryViewActive() || !(mount.probabilityDetailPanel instanceof HTMLElement)) return;
			const detailIndex = Number.isInteger(mount.latestProbabilityDetailIndex)
				? mount.latestProbabilityDetailIndex
				: Number(mount.probabilityDetailPanel.dataset.activeIndex);
			if (!Number.isInteger(detailIndex) || detailIndex < 0) return;
			const detailPoint = getDatasetPoint(mount.priceChart, detailIndex, 0);
			const detailModel = buildProbabilityGridModel(detailIndex, detailPoint);
			if (detailModel) mount.renderProbabilityDetail(detailIndex, detailModel);
			else mount.hideProbabilityDetail();
		};
		const scheduleProbabilityDetailRefresh = (passes = 1) => {
			mount.probabilityDetailRefreshPasses = Math.max(
				mount.probabilityDetailRefreshPasses,
				Math.max(1, Number(passes) || 1),
			);
			if (mount.probabilityDetailRefreshFrameId !== null) return;
			const refresh = () => {
				mount.probabilityDetailRefreshFrameId = null;
				if (mount.controllerDestroyed) {
					mount.probabilityDetailRefreshPasses = 0;
					return;
				}
				refreshActiveProbabilityDetail();
				mount.probabilityDetailRefreshPasses -= 1;
				if (mount.probabilityDetailRefreshPasses <= 0) {
					mount.probabilityDetailRefreshPasses = 0;
					return;
				}
				mount.probabilityDetailRefreshFrameId = mount.requestControllerAnimationFrame(refresh);
			};
			mount.probabilityDetailRefreshFrameId = mount.requestControllerAnimationFrame(refresh);
		};
		const refreshProbabilityDetailAfterViewChange = () => {
			if (!mount.isProbabilityHistoryViewActive()) {
				mount.probabilityDetailLayoutObserver?.disconnect?.();
				mount.probabilityDetailLayoutObserver = null;
				refreshActiveProbabilityDetail();
				mount.resultsStack?.dispatchEvent(new Event(mount.PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT));
				return;
			}
			if (typeof ResizeObserver === "function"
				&& !mount.probabilityDetailLayoutObserver
				&& mount.probabilityDetailGrid?.parentElement) {
				mount.probabilityDetailLayoutObserver = new ResizeObserver(() => {
					scheduleProbabilityDetailRefresh();
				});
				mount.probabilityDetailLayoutObserver.observe(mount.probabilityDetailGrid.parentElement);
			}
			refreshActiveProbabilityDetail();
			// The active detail view changes the history rail's minimum demand. Let
			// the shared section resizer recalculate its range after the panel state
			// has been committed.
			mount.resultsStack?.dispatchEvent(new Event(mount.PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT));
			scheduleProbabilityDetailRefresh(2);
		};
		window.addEventListener(
			mount.BACKTEST_HISTORY_VIEW_CHANGE_EVENT,
			refreshProbabilityDetailAfterViewChange,
			{signal: mount.documentController.signal},
		);
		const isProbabilityHoverPointerOverStack = (stackRect) => (
			mount.probabilityHoverPointerActive
			&& Number.isFinite(mount.probabilityHoverPointerX)
			&& Number.isFinite(mount.probabilityHoverPointerY)
			&& mount.probabilityHoverPointerX >= stackRect.left
			&& mount.probabilityHoverPointerX <= stackRect.right
			&& mount.probabilityHoverPointerY >= stackRect.top
			&& mount.probabilityHoverPointerY <= stackRect.bottom
		);

		const updateSharedTooltip = (index, sourceCanvas, sourceChart) => {
			if (index === null) {
				mount.hoverLine.classList.remove("is-visible");
				mount.hoverCrosshairLine.classList.remove("is-visible");
				mount.tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			const stackRect = mount.tradeChartStack.getBoundingClientRect();
			const sourcePoint = getDatasetPoint(sourceChart, index, 0);
			const pricePoint = getDatasetPoint(mount.priceChart, index, 0);
			const equityPoint = getDatasetPoint(mount.equityChart, index, 0);
			const canonicalLinePoint = pricePoint || equityPoint || sourcePoint;
			const canonicalLineCanvas = pricePoint ? mount.priceCanvas : (equityPoint ? mount.equityCanvas : sourceCanvas);
			if (!sourcePoint) {
				mount.hoverLine.classList.remove("is-visible");
				mount.hoverCrosshairLine.classList.remove("is-visible");
				mount.tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			const tooltipAnchorPosition = getRelativePointPosition(sourceCanvas, stackRect, sourcePoint);
			if (!tooltipAnchorPosition) {
				mount.hoverLine.classList.remove("is-visible");
				mount.hoverCrosshairLine.classList.remove("is-visible");
				mount.tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			let probabilityRendered = false;
			if (mount.activePriceOverlay && pricePoint) {
				probabilityRendered = renderProbabilityTooltip(index, stackRect, pricePoint);
			}
			const currentStackRect = mount.tradeChartStack.getBoundingClientRect();
			const curveHoverLinePosition = getRelativePointPosition(
				canonicalLineCanvas,
				currentStackRect,
				canonicalLinePoint,
			);
			if (!curveHoverLinePosition) {
				mount.hoverLine.classList.remove("is-visible");
				mount.hoverCrosshairLine.classList.remove("is-visible");
				mount.tooltip.classList.remove("is-visible");
				hideProbabilityTooltip();
				return false;
			}
			const hoverLinePosition = curveHoverLinePosition;
			if (mount.strategyPresentation) {
				if (probabilityRendered && mount.pinState.mode !== "pinned"
					&& isProbabilityHoverPointerOverStack(currentStackRect)) {
					updatePointerHoverLine();
				} else {
					updateCurveHoverLine();
				}
			} else {
				const hoverLineFrame = updateHoverLineFrame();
				if (hoverLineFrame) {
					mount.hoverLine.style.top = `${hoverLineFrame.top}px`;
					mount.hoverLine.style.height = `${Math.max(0, hoverLineFrame.bottom - hoverLineFrame.top)}px`;
				}
				mount.hoverLine.style.setProperty("--trade-chart-hover-line-x", `${hoverLinePosition.x}px`);
				mount.hoverLine.classList.add("is-visible");
				mount.hoverCrosshairLine.classList.remove("is-visible");
			}
			if (probabilityRendered) {
				mount.tooltip.classList.remove("is-visible");
				return true;
			}
			hideProbabilityTooltip({immediate: sourceCanvas !== mount.priceCanvas});
			const relativeX = hoverLinePosition.x;
			const visualRelativeX = relativeX - mount.probabilityScrollVisualPosition;
			const relativeY = tooltipAnchorPosition.y;
			const closeValue = Number(mount.close[index] || 0);
			const equityValue = Number(mount.equity[index] || 0);
			const allInValue = Number(mount.allInEquity[index] || 0);
			const allInLeveragedValue = Number(mount.allInLeveragedEquity[index] || 0);
			const netReturn = mount.initialCapital > 0 ? ((equityValue / mount.initialCapital) - 1) * 100 : 0;
			const versusAllIn = equityValue - allInValue;
			const parsedLabelDate = mount.parseRawDate(mount.rawDates[index]);
			mount.tooltip.querySelector(".chart-tooltip-date").textContent = parsedLabelDate ? mount.formatChartDate(parsedLabelDate) : mount.labels[index];
			mount.tooltip.querySelector('[data-role="close"]').textContent = mount.formatMoney(closeValue);
			mount.tooltip.querySelector('[data-role="return"]').textContent = mount.formatReturn(netReturn);
			mount.tooltip.querySelector('[data-role="equity"]').textContent = mount.formatMoney(equityValue);
			mount.tooltip.querySelector('[data-role="all-in"]').textContent = mount.formatMoney(allInValue);
			if (mount.hasLeveragedBenchmark) {
				mount.tooltip.querySelector('[data-role="all-in-leveraged"]').textContent = mount.formatMoney(
					allInLeveragedValue,
				);
			}
			const vsAllInValue = mount.tooltip.querySelector('[data-role="vs-all-in"]');
			vsAllInValue.textContent = `${versusAllIn >= 0 ? "+" : "-"}${mount.formatMoney(Math.abs(versusAllIn))}`;
			vsAllInValue.style.color = versusAllIn >= 0 ? mount.resolvedTheme.accentPositive : mount.resolvedTheme.accentSecondary;
			const setTooltipDotColor = (role, color) => {
				const dot = mount.tooltip.querySelector(`[data-dot-role="${role}"]`);
				if (dot) dot.style.backgroundColor = color;
			};
			setTooltipDotColor("close", mount.resolvedTheme.accentPrimary);
			setTooltipDotColor(
				"return",
				equityValue >= mount.initialCapital
					? mount.resolvedTheme.accentPositive
					: mount.resolvedTheme.accentSecondary,
			);
			setTooltipDotColor("equity", mount.resolvedTheme.text);
			setTooltipDotColor("all-in-primary", mount.resolvedTheme.muted);
			if (mount.hasLeveragedBenchmark) {
				setTooltipDotColor("all-in-leveraged", mount.resolvedTheme.muted);
			}
			setTooltipDotColor(
				"vs-all-in",
				versusAllIn >= 0 ? mount.resolvedTheme.accentPositive : mount.resolvedTheme.accentSecondary,
			);
			const tooltipWidth = mount.tooltip.offsetWidth || 220;
			const rightSpace = stackRect.width - visualRelativeX;
			const visualLeft = rightSpace >= tooltipWidth + 20
				? visualRelativeX + 14
				: Math.max(12, visualRelativeX - tooltipWidth - 14);
			const left = visualLeft + mount.probabilityScrollVisualPosition;
			const tooltipHeight = mount.tooltip.offsetHeight || 156;
			const padding = 12;
			let top = relativeY - (tooltipHeight / 2);
			if (top < padding) top = padding;
			if (top + tooltipHeight > stackRect.height - padding) top = stackRect.height - tooltipHeight - padding;
			mount.tooltip.style.left = `${left}px`;
			mount.tooltip.style.top = `${Math.max(padding, top)}px`;
			mount.tooltip.classList.add("is-visible");
			return false;
		};
		const getPricePlotFrame = (stackRect) => {
			if (!mount.priceChart?.chartArea || !mount.priceChart?.width || !mount.priceChart?.height) return null;
			const canvasRect = mount.priceCanvas.getBoundingClientRect();
			const canvasContentLeft = getPriceCanvasContentLeft();
			if (!Number.isFinite(canvasContentLeft)) return null;
			const scaleX = canvasRect.width / mount.priceChart.width;
			const scaleY = canvasRect.height / mount.priceChart.height;
			return {
				left: canvasContentLeft + (mount.priceChart.chartArea.left * scaleX),
				right: canvasContentLeft + (mount.priceChart.chartArea.right * scaleX),
				top: canvasRect.top - stackRect.top + (mount.priceChart.chartArea.top * scaleY),
				bottom: canvasRect.top - stackRect.top + (mount.priceChart.chartArea.bottom * scaleY),
			};
		};
		const getProbabilityHoverGuide = (stackRect) => {
			if (!isProbabilityHoverPointerOverStack(stackRect)) return null;
			const pointerScreenX = mount.probabilityHoverPointerX - stackRect.left;
			const resolved = resolveProbabilityPointerIntersection(pointerScreenX, stackRect);
			if (!resolved) return null;
			// Reading a guide must not select a new date or mutate the frame.
			const stableIntersection = mount.probabilityHoverIntersection || resolved.intersection;
			const stableContentX = (resolved.canvasRect.left - stackRect.left)
				+ mount.probabilityScrollVisualPosition + stableIntersection.x * resolved.scaleX;
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
				mount.strategyPresentation
				&& mount.pinState.mode !== "pinned"
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
			if (!geometry || !mount.priceChart?.height) return null;
			const canvasRect = mount.priceCanvas.getBoundingClientRect();
			const scaleY = canvasRect.height / Number(mount.priceChart.height);
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
			if (!(mount.probabilityTooltip instanceof HTMLElement) || !geometry) return null;
			// The caller's rectangle can predate a responsive/layout pass.
			const currentStackRect = mount.tradeChartStack.getBoundingClientRect();
			const contentLeft = getProbabilityFieldContentLeft(currentStackRect, geometry);
			const pointerAnchored = (
				mount.strategyPresentation
				&& mount.pinState.mode !== "pinned"
				&& isProbabilityHoverPointerOverStack(currentStackRect)
			);
			const canvasRect = mount.priceCanvas.getBoundingClientRect();
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
			mount.setInlineStyleIfChanged(
				mount.probabilityTooltip,
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
				mount.hoverLine.style.top = `${hoverLineFrame.top}px`;
				mount.hoverLine.style.height = `${Math.max(0, hoverLineFrame.bottom - hoverLineFrame.top)}px`;
			}
			mount.hoverLine.style.setProperty("--trade-chart-hover-line-x", `${x}px`);
			mount.hoverLine.classList.add("is-visible");
			const fixedPlotLeft = plotFrame.left + mount.probabilityScrollVisualPosition;
			mount.hoverCrosshairLine.style.left = `${fixedPlotLeft}px`;
			mount.hoverCrosshairLine.style.width = `${Math.max(0, resolvedHorizontalEnd - fixedPlotLeft)}px`;
			mount.hoverCrosshairLine.style.top = `${y}px`;
			mount.hoverCrosshairLine.classList.add("is-visible");
			mount.updateHoverDateLabel(x, plotFrame.bottom, mount.activeIndex);
			if (mount.probabilityHint) {
				const bounds = mount.priceChart?._activeBacktestProbabilityGridBounds;
				const empty = bounds && bounds.maxOpacity === 0;
				const overflow = horizontalEnd - mount.probabilityScrollVisualPosition > mount.tradeChartStack.clientWidth + 1;
				const copy = empty
					? `All cells below ${Number(mount.strategyPresentation.cell_display_threshold_pct).toFixed(2)}% · max ${(bounds.maxProbability * 100).toFixed(2)}%`
					: overflow ? "Drag left to explore future cells" : "";
				if (mount.probabilityHint.textContent !== copy) mount.probabilityHint.textContent = copy;
				mount.probabilityHint.style.left = `${plotFrame.left + 8}px`;
				mount.probabilityHint.style.top = `${plotFrame.top + 8}px`;
				mount.probabilityHint.hidden = !copy;
				mount.tradeChartStack.classList.toggle("has-probability-overflow", overflow);
			}
			// The Y-axis badge is painted by the Chart.js overlay plugin. Redraw
			// after the pointer guide has settled so its value follows the exact
			// curve intersection rather than the nearest source point.
			mount.priceChart?.draw?.();
			return true;
		};
		const updatePointerHoverLine = () => {
			if (
				!mount.strategyPresentation
				|| !mount.activePriceOverlay
				|| mount.pinState.mode === "pinned"
				|| !Number.isInteger(mount.activeIndex)
			) return;
			let currentStackRect = mount.tradeChartStack.getBoundingClientRect();
			if (!isProbabilityHoverPointerOverStack(currentStackRect)) return;
			const currentPricePoint = getDatasetPoint(mount.priceChart, mount.activeIndex, 0);
			let probabilityBounds = mount.priceChart._activeBacktestProbabilityGridBounds;
			if (!currentPricePoint || !probabilityBounds) return;
			syncProbabilityFieldVisualPosition(currentStackRect, probabilityBounds);
			currentStackRect = mount.tradeChartStack.getBoundingClientRect();
			let plotFrame = getPricePlotFrame(currentStackRect);
			let guide = getProbabilityHoverGuide(currentStackRect);
			if (
				guide?.intersection
				&& Math.abs(Number(guide.intersection.y) - Number(probabilityBounds.anchorY)) > 0.01
			) {
				// A scroll or visual translation can settle after the original render.
				// Rebuild the floating lattice from that final intersection instead of
				// leaving its cells attached to the previous frame's Y coordinate.
				if (renderProbabilityTooltip(mount.activeIndex, currentStackRect, currentPricePoint)) {
					probabilityBounds = mount.priceChart._activeBacktestProbabilityGridBounds;
					currentStackRect = mount.tradeChartStack.getBoundingClientRect();
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
				probabilityBounds.targetScrollLeft = mount.probabilityScrollTarget;
				probabilityBounds.pointerAnchored = true;
				if (guide?.intersection) {
					probabilityBounds.intersectionX = guide.intersection.x;
					probabilityBounds.intersectionY = guide.intersection.y;
				}
			}
		};
		const updateCurveHoverLine = () => {
			if (!Number.isInteger(mount.activeIndex)) return;
			const currentStackRect = mount.tradeChartStack.getBoundingClientRect();
			const currentPricePoint = getDatasetPoint(mount.priceChart, mount.activeIndex, 0);
			if (!currentPricePoint) return;
			const curveHoverLinePosition = getRelativePointPosition(
				mount.priceCanvas,
				currentStackRect,
				currentPricePoint,
			);
			if (!curveHoverLinePosition) return;
			const probabilityBounds = mount.priceChart._activeBacktestProbabilityGridBounds;
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
		mount.probabilityFieldPositionUpdater = () => {
			if (!mount.activePriceOverlay || mount.pinState.mode === "pinned") return;
			const bounds = mount.priceChart?._activeBacktestProbabilityGridBounds;
			if (!bounds || !mount.probabilityTooltip?.classList.contains("is-visible")) return;
			const currentStackRect = mount.tradeChartStack.getBoundingClientRect();
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
		Object.assign(continuation, {
			buildProbabilityDetailModel,
			isProbabilityHoverPointerOverStack,
			scheduleProbabilityDetailRefresh,
			updateCurveHoverLine,
		});
		const commitProbabilityPointerFrame = ({synchronizeScroll = true} = {}) => {
			if (mount.pinState.mode === "pinned" || !mount.priceChart?.ctx) return;
			const stackRect = mount.tradeChartStack.getBoundingClientRect();
			if (!isProbabilityHoverPointerOverStack(stackRect)) return;
			cancelScheduledHoverSync();
			const pointerX = mount.probabilityHoverPointerX - stackRect.left;
			const initial = resolveProbabilityPointerIntersection(pointerX, stackRect);
			if (!initial) return;
			if (synchronizeScroll && !mount.probabilityPanGesture?.dragging) {
				const point = getDatasetPoint(mount.priceChart, initial.intersection.index, 0);
				const model = buildProbabilityGridModel(initial.intersection.index, point);
				const fieldWidth = Number(model?.geometry?.width) || 0;
				// Solve pan from screen X and static dimensions, not from the prior
				// pan or field rectangle. The endpoint must not move left of the
				// cursor. Rendering then consumes this single settled coordinate frame.
				const nextTarget = Math.min(
					Math.max(0, pointerX + fieldWidth - stackRect.width + mount.probabilityManualPanOffset),
					Math.max(0, initial.lastContentX - pointerX),
				);
				if (Math.abs(nextTarget - mount.probabilityScrollTarget) > 0.01) {
					const wasUpdating = mount.isUpdatingProbabilityFieldPosition;
					mount.isUpdatingProbabilityFieldPosition = true;
					try {
						mount.setProbabilityScrollTarget(nextTarget, {immediate: true});
					} finally {
						mount.isUpdatingProbabilityFieldPosition = wasUpdating;
					}
				}
			}
			const settled = resolveProbabilityPointerIntersection(pointerX, stackRect);
			if (!settled) return;
			mount.probabilityHoverIntersection = settled.intersection;
			const index = settled.intersection.index;
			mount.pinState = mount.probabilityGridApi.reducePinState?.(mount.pinState, {type: "track", index})
				|| {mode: "tracking", activeIndex: index};
			if (index !== mount.activeIndex || mount.activeSourceCanvas !== mount.priceCanvas) {
				syncHoverState(index, mount.priceCanvas, mount.priceChart);
			} else {
				updatePointerHoverLine();
			}
		};
		const schedulePointerHoverLineUpdate = () => {
			if (mount.pointerHoverFrameId !== null) return;
			mount.pointerHoverFrameId = mount.requestControllerAnimationFrame(() => {
				mount.pointerHoverFrameId = null;
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
			mount.activeIndex = index;
			mount.activeSourceCanvas = index === null ? null : sourceCanvas;
			mount.activeSourceChart = index === null ? null : sourceChart;
			mount.activePriceOverlay = Boolean(mount.strategyPresentation && index !== null && sourceCanvas === mount.priceCanvas);
			const showTradeDetails = mount.isBacktestTradeDetailsEnabled();
			const setActive = (chart) => {
				if (!chart || !chart.ctx) return;
				if (chart === mount.equityChart && !showTradeDetails) return;
				chart.setActiveElements(index === null ? [] : [{ datasetIndex: 0, index }]);
				if (typeof chart.draw === "function") chart.draw();
				else chart.update("none");
			};
			setActive(mount.priceChart);
			setActive(mount.equityChart);
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
			mount.pendingHoverUpdate = null;
			if (mount.hoverFrameId !== null) {
				mount.cancelControllerAnimationFrame(mount.hoverFrameId);
				mount.hoverFrameId = null;
			}
		};

		const scheduleHoverSync = (index, sourceCanvas, sourceChart) => {
			if (
				index === mount.activeIndex
				&& sourceCanvas === mount.activeSourceCanvas
				&& sourceChart === mount.activeSourceChart
			) {
				cancelScheduledHoverSync();
				return;
			}
			if (
				mount.pendingHoverUpdate?.index === index
				&& mount.pendingHoverUpdate.sourceCanvas === sourceCanvas
				&& mount.pendingHoverUpdate.sourceChart === sourceChart
			) return;
			mount.pendingHoverUpdate = {index, sourceCanvas, sourceChart};
			if (mount.hoverFrameId !== null) return;
			mount.hoverFrameId = mount.requestControllerAnimationFrame(() => {
				mount.hoverFrameId = null;
				const pending = mount.pendingHoverUpdate;
				mount.pendingHoverUpdate = null;
				if (!pending || mount.pinState.mode === "pinned" || !pending.sourceChart?.ctx) return;
				if (
					pending.index === mount.activeIndex
					&& pending.sourceCanvas === mount.activeSourceCanvas
					&& pending.sourceChart === mount.activeSourceChart
				) return;
				mount.pinState = mount.probabilityGridApi.reducePinState?.(
					mount.pinState,
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
			const hoverSurface = canvas === mount.priceCanvas && mount.strategyPresentation
				? mount.tradeChartStack
				: canvas;

			hoverSurface.addEventListener("mousemove", (event) => {
				if (!chart || !chart.ctx) return;
				if (mount.pinState.mode === "pinned") return;
				if (
					canvas === mount.priceCanvas
					&& mount.strategyPresentation
					&& event.target instanceof Node
					&& mount.equityCanvas?.closest(".trade-chart-panel")?.contains(event.target)
				) return;
				if (canvas === mount.priceCanvas && mount.strategyPresentation) {
					// Cancel the equity leave frame before it can clear the new price pointer.
					cancelScheduledHoverSync();
					mount.probabilityHoverPointerX = Number(event.clientX);
					mount.probabilityHoverPointerY = Number(event.clientY);
					mount.probabilityHoverPointerActive = true;
					schedulePointerHoverLineUpdate();
					return;
				}
				scheduleHoverSync(resolveNearestHoverIndex(chart, event), canvas, chart);
			}, { signal });

			if (canvas !== mount.priceCanvas || !mount.strategyPresentation) {
				canvas.addEventListener("mouseleave", () => {
					if (!chart || !chart.ctx) return;
					if (mount.pinState.mode === "pinned") return;
					scheduleHoverSync(null, canvas, chart);
				}, { signal });
			}

			if (canvas === mount.priceCanvas && mount.strategyPresentation) {
				hoverSurface.addEventListener("mouseleave", (event) => {
					if (!chart || !chart.ctx) return;
					if (mount.probabilityPanGesture) return;
					if (mount.pinState.mode === "pinned") return;
					if (mount.isProbabilityAuxiliarySurface(event.relatedTarget)) return;
					mount.resetProbabilityHoverPointer();
					scheduleHoverSync(null, canvas, chart);
				}, { signal });
			}

			if (canvas === mount.priceCanvas && mount.strategyPresentation) {
				const isPrimaryPointer = (event) => (
					event.button === 0
					|| (event.pointerType === "touch" && event.button === -1)
				);
				const pinProbabilityAtPointer = (event) => {
					if (!chart || !chart.ctx) return;
					cancelScheduledHoverSync();
					const nearestIndex = resolveNearestHoverIndex(chart, event);
					const trackedIndex = mount.pinState.mode !== "pinned"
						&& mount.activePriceOverlay
						&& mount.probabilityTooltip?.classList.contains("is-visible")
						&& Number.isInteger(mount.activeIndex)
						? mount.activeIndex
						: nearestIndex;
					const point = Number.isInteger(trackedIndex)
						? chart.getDatasetMeta(0)?.data?.[trackedIndex]
						: null;
					const canvasRect = canvas.getBoundingClientRect();
					const pointerY = event.clientY - canvasRect.top;
					const isCurvePress = Number.isInteger(trackedIndex)
						&& mount.probabilityGridApi.isPointNearCurve?.(pointerY, point?.y, 14);
					const probabilityRendered = isCurvePress
						? renderProbabilityTooltip(
							trackedIndex,
							mount.tradeChartStack.getBoundingClientRect(),
							point,
						)
						: false;
					if (probabilityRendered) {
						mount.pinState = mount.probabilityGridApi.reducePinState?.(
							mount.pinState,
							{type: "pin", index: trackedIndex},
						) || {mode: "pinned", activeIndex: trackedIndex};
						mount.snapProbabilityScrollToFit();
						syncHoverState(trackedIndex, canvas, chart);
						return true;
					}
					if (mount.pinState.mode === "pinned") {
						mount.pinState = mount.probabilityGridApi.reducePinState?.(mount.pinState, {type: "clear"})
							|| {mode: "tracking", activeIndex: null};
						syncHoverState(null, canvas, chart);
						return true;
					} else if (isCurvePress) {
						mount.pinState = mount.probabilityGridApi.reducePinState?.(
							mount.pinState,
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
					if (mount.pinState.mode !== "pinned") {
						mount.probabilityHoverPointerX = event.clientX;
						mount.probabilityHoverPointerY = event.clientY;
						mount.probabilityHoverPointerActive = true;
						// A press targets the curve currently on screen, including a
						// touch tap with no preceding hover. Do not move it on press.
						commitProbabilityPointerFrame({synchronizeScroll: false});
					}
					if (mount.pinState.mode !== "pinned" && mount.activePriceOverlay
						&& mount.tradeChartStack.classList.contains("has-probability-overflow")) {
						mount.probabilityPanGesture = {
							pointerId: event.pointerId, startX: event.clientX,
							startPan: mount.probabilityScrollVisualPosition, dragging: false,
						};
						const point = getDatasetPoint(chart, mount.activeIndex, 0);
						const curvePress = mount.probabilityGridApi.isPointNearCurve?.(
							event.clientY - canvas.getBoundingClientRect().top, point?.y, 14,
						);
						if (curvePress) {
							// Keep primary-press pin feedback, but defer its viewport snap
							// until release so a subsequent drag starts without a jump.
							mount.probabilityPanGesture.provisionalPin = true;
						mount.pinState = {mode: "pinned", activeIndex: mount.activeIndex};
							mount.probabilityTooltip.dataset.pinned = "true";
						}
						// Keep the compatibility click owned by the price canvas. A
						// stack-targeted click is otherwise interpreted as an outside click.
						canvas.setPointerCapture(event.pointerId);
						return;
					}
					suppressNextProbabilityClick = pinProbabilityAtPointer(event) === true;
				}, { signal });
				hoverSurface.addEventListener("pointermove", (event) => {
					const gesture = mount.probabilityPanGesture;
					if (!gesture || gesture.pointerId !== event.pointerId) return;
					const delta = gesture.startX - event.clientX;
					if (!gesture.dragging && Math.abs(delta) < 4) return;
					gesture.dragging = true;
					if (gesture.provisionalPin) {
						mount.pinState = {mode: "tracking", activeIndex: mount.activeIndex};
						mount.probabilityTooltip.dataset.pinned = "false";
						gesture.provisionalPin = false;
					}
					event.preventDefault();
					mount.tradeChartStack.classList.add("is-probability-dragging");
					mount.probabilityHoverPointerX = event.clientX;
					mount.probabilityHoverPointerY = event.clientY;
					mount.probabilityHoverPointerActive = true;
					const rect = mount.tradeChartStack.getBoundingClientRect();
					const pointerX = event.clientX - rect.left;
					const resolved = resolveProbabilityPointerIntersection(pointerX, rect);
					if (!resolved) return;
					const nextPan = Math.min(Math.max(0, gesture.startPan + delta),
						Math.max(0, resolved.lastContentX - pointerX));
					const wasUpdating = mount.isUpdatingProbabilityFieldPosition;
					mount.isUpdatingProbabilityFieldPosition = true;
					try { mount.setProbabilityScrollTarget(nextPan, {immediate: true}); }
					finally { mount.isUpdatingProbabilityFieldPosition = wasUpdating; }
					commitProbabilityPointerFrame({synchronizeScroll: false});
				}, {signal});
				const finishProbabilityDrag = (event) => {
					const gesture = mount.probabilityPanGesture;
					if (!gesture || gesture.pointerId !== event.pointerId) return;
					mount.probabilityPanGesture = null;
					mount.tradeChartStack.classList.remove("is-probability-dragging");
					if (gesture.provisionalPin) mount.pinState = {mode: "tracking", activeIndex: mount.activeIndex};
					if (gesture.dragging) {
						const rect = mount.tradeChartStack.getBoundingClientRect();
						const width = Number(mount.priceChart._activeBacktestProbabilityGridBounds?.width) || 0;
						mount.probabilityManualPanOffset = mount.probabilityScrollVisualPosition
							- (mount.probabilityHoverPointerX - rect.left + width - rect.width);
						suppressNextProbabilityClick = true;
					} else if (event.type === "pointerup") {
						suppressNextProbabilityClick = pinProbabilityAtPointer(event) === true;
					}
					if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
					if (event.type === "pointercancel"
						|| !isProbabilityHoverPointerOverStack(mount.tradeChartStack.getBoundingClientRect())) {
						mount.resetProbabilityHoverPointer();
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

		const refreshTransition = mount.consumeBacktestRefreshTransition();
		const seriesLineWidth = mount.readPxToken(mount.tradeChartStack, "--trade-chart-series-line-width", 2.0);
		const priceSeriesStart = refreshTransition
			? mount.buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.close, mount.rawDates, mount.close)
			: mount.close;
		const equitySeriesStart = refreshTransition
			? mount.buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.equity, mount.rawDates, mount.equity)
			: mount.equity;
		const allInSeriesStart = refreshTransition
			? mount.buildAlignedSeries(refreshTransition.rawLabels, refreshTransition.allIn, mount.rawDates, mount.allInEquity)
			: mount.allInEquity;
		const allInLeveragedSeriesStart = mount.hasLeveragedBenchmark
			? refreshTransition
				? mount.buildAlignedSeries(
					refreshTransition.rawLabels,
					refreshTransition.allInLeveraged,
					mount.rawDates,
					mount.allInLeveragedEquity,
				)
				: mount.allInLeveragedEquity
			: [];
		const priceYScale = mount.buildPixelPaddedYScale(mount.priceCanvas, [priceSeriesStart], mount.priceChartYPadding);
		const equityYScale = mount.buildPixelPaddedYScale(
			mount.equityCanvas,
			[
				equitySeriesStart,
				allInSeriesStart,
				...(mount.hasLeveragedBenchmark ? [allInLeveragedSeriesStart] : []),
			],
			mount.chartYPaddingPx,
		);
		const markBacktestChartReady = (canvas) => {
			if (!canvas || canvas.dataset.tradeChartReady === "1") return;
			canvas.dataset.tradeChartReady = "1";
			if (mount.priceCanvas.dataset.tradeChartReady === "1" && mount.equityCanvas.dataset.tradeChartReady === "1") {
				if (document.getElementById("workspace_panel")?.dataset.workspacePending !== "1") {
					mount.bootstrap.setBacktestLoadState?.("ready");
				}
				mount.bootstrap.workspaceShare?.dispatchReady?.("backtest");
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
				if (typeof cleanupReadyFrame === "function") mount.controllerTaskCleanups.push(cleanupReadyFrame);
			} else {
				mount.requestControllerAnimationFrame(() => {
					mount.requestControllerAnimationFrame(() => markBacktestChartReady(canvas));
				});
			}
			return false;
		};

		mount.priceChart = new Chart(mount.priceCanvas, {
			type: "line",
			data: {
				labels: mount.labels,
				rawLabels: mount.rawDates,
				datasets: [
					{
						label: "Close",
						data: priceSeriesStart,
						borderColor: mount.isCandlestick ? "transparent" : mount.resolvedTheme.accentPrimary,
						borderWidth: mount.isCandlestick ? 0 : seriesLineWidth,
						pointRadius: 0,
						pointHoverRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => (
								mount.isSessionGap(context.p0DataIndex, context.p1DataIndex)
									? "rgba(0, 0, 0, 0)"
									: mount.resolvedTheme.accentPrimary
							),
						},
					},
				],
			},
			options: {
				...commonOptions,
				animation: resolveChartReadyAnimation(mount.priceCanvas),
				scales: {
					...commonOptions.scales,
					x: { ...commonOptions.scales.x, display: false },
					y: {
						...commonOptions.scales.y,
						...priceYScale,
						ticks: buildYAxisTicks(2, mount.formatStockPriceAxisValue),
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
		mount.priceChart.$backtestTradeMarkerPoints = mount.tradeMarkerPoints;

		const benchmarkLineWidth = 1.0;
		mount.equityChart = new Chart(mount.equityCanvas, {
			type: "line",
			data: {
				labels: mount.labels,
				rawLabels: mount.rawDates,
				datasets: [
					{
						label: "Equity",
						data: equitySeriesStart,
						borderColor: mount.resolvedTheme.accentPositive,
						borderWidth: 2.0,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => {
								if (mount.isSessionGap(context.p0DataIndex, context.p1DataIndex)) {
									return "rgba(0, 0, 0, 0)";
								}
								const target = Number(context.p1?.parsed?.y ?? context.p0?.parsed?.y ?? mount.initialCapital);
								return target >= mount.initialCapital ? mount.resolvedTheme.accentPositive : mount.resolvedTheme.accentSecondary;
							},
						},
					},
					{
						label: mount.hasLeveragedBenchmark ? `All in ${mount.primaryTicker}` : "If all in",
						data: allInSeriesStart,
						borderColor: mount.allInPrimaryReferenceColor,
						borderWidth: benchmarkLineWidth,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => (
								mount.isSessionGap(context.p0DataIndex, context.p1DataIndex)
									? "rgba(0, 0, 0, 0)"
									: mount.allInPrimaryReferenceColor
							),
						},
					},
					...(mount.hasLeveragedBenchmark ? [{
						label: `All in ${mount.leveragedTicker}`,
						data: allInLeveragedSeriesStart,
						borderColor: mount.allInLeveragedReferenceColor,
						borderWidth: benchmarkLineWidth,
						pointRadius: 0,
						tension: 0,
						borderJoinStyle: "round",
						borderCapStyle: "round",
						segment: {
							borderColor: (context) => (
								mount.isSessionGap(context.p0DataIndex, context.p1DataIndex)
									? "rgba(0, 0, 0, 0)"
									: mount.allInLeveragedReferenceColor
							),
						},
					}] : []),
				],
			},
			options: {
				...commonOptions,
				animation: resolveChartReadyAnimation(mount.equityCanvas),
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
				window.addEventListener("worthward:local-store-pagination-ready", initTransactionsPagination, {once: true, signal: mount.documentController.signal});
				return;
			}

			const indexByDate = new Map();
			mount.rawDates.forEach((value, index) => {
				indexByDate.set(String(value), index);
				const formatted = mount.formatTradeMarkerDateKey(value, mount.interval);
				if (formatted) indexByDate.set(formatted, index);
			});

			const trades = mount.backtestResult.trades || [];
			const showTicker = Boolean(mount.backtestResult.multi_asset);
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
				mount.bootstrap.workspaceTablePage = nextPage;
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
				const formatShortDateParts = mount.bootstrap.dateDisplay?.formatShortDateParts;
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

		attachHover(mount.priceCanvas, mount.priceChart);
		attachHover(mount.equityCanvas, mount.equityChart);
		if (mount.strategyPresentation) {
			const isProbabilityHoverSurface = (target) => (
				target instanceof Node
				&& (
					mount.tradeChartStack.contains(target)
					|| mount.isProbabilityAuxiliarySurface(target)
				)
			);
			const clearProbabilityFieldOnLeave = (relatedTarget) => {
				if (mount.probabilityPanGesture) return;
				const remainsOnProbabilitySurface = isProbabilityHoverSurface(relatedTarget);
				mount.probabilityHoverPointerActive = remainsOnProbabilitySurface
					&& mount.tradeChartStack.contains(relatedTarget);
				if (remainsOnProbabilitySurface) {
					if (!mount.probabilityHoverPointerActive) updateCurveHoverLine();
					return;
				}
				if (!mount.priceChart?.ctx || mount.pinState.mode === "pinned") return;
				cancelScheduledHoverSync();
				if (mount.pointerHoverFrameId !== null) {
					mount.cancelControllerAnimationFrame(mount.pointerHoverFrameId);
					mount.pointerHoverFrameId = null;
				}
				mount.pinState = mount.probabilityGridApi.reducePinState?.(mount.pinState, {type: "clear"})
					|| {mode: "tracking", activeIndex: null};
				syncHoverState(null, mount.priceCanvas, mount.priceChart);
			};
			mount.tradeChartStack.addEventListener("mouseleave", (event) => {
				clearProbabilityFieldOnLeave(event.relatedTarget);
			}, {signal: mount.documentController.signal});
				mount.probabilityScrollPort?.addEventListener("mouseleave", (event) => {
					clearProbabilityFieldOnLeave(event.relatedTarget);
				}, {signal: mount.documentController.signal});
				mount.probabilityScrollResizer?.addEventListener("mouseleave", (event) => {
					clearProbabilityFieldOnLeave(event.relatedTarget);
				}, {signal: mount.documentController.signal});
		}
		// Probability cells are clipped to the existing Chart.js plot area. They
		// must not expand Y-axis padding or change the curve's drawing range.
		const resolvePriceChartYPadding = () => mount.chartYPaddingPx;
		mount.priceChartYPadding = resolvePriceChartYPadding();
		mount.applyBacktestYAxisScale(
			mount.priceChart,
			mount.priceCanvas,
			[mount.priceChart.data.datasets[0].data],
			mount.priceChartYPadding,
		);
		mount.priceChart.update("none");
		if (mount.strategyPresentation) {
			const defaultIndex = mount.strategyPresentation.predictive_mean.reduce(
				(latestIndex, meanValue, index) => (
					Number.isFinite(Number(meanValue))
						&& Number(mount.strategyPresentation.predictive_scale?.[index]) > 0
						&& Number(mount.close[index]) > 0
						? index
						: latestIndex
				),
				-1,
			);
			const defaultPoint = getDatasetPoint(mount.priceChart, defaultIndex, 0);
			const defaultModel = defaultIndex >= 0
				? buildProbabilityGridModel(defaultIndex, defaultPoint)
				: null;
            if (defaultModel) {
                if (!mount.renderProbabilityDetail(defaultIndex, defaultModel)) {
                    scheduleProbabilityDetailRefresh(3);
                }
            } else mount.hideProbabilityDetail();
		}
		mount.publishProbabilityStageMinimum();
		const refreshChartLayout = ({chartsAlreadyResized = false} = {}) => {
			if (mount.controllerDestroyed || !mount.priceChart?.ctx || !mount.equityChart?.ctx) return;
			const showTradeDetails = mount.isBacktestTradeDetailsEnabled();
			const refreshIndex = mount.pinState.mode === "pinned"
				? mount.pinState.activeIndex
				: mount.activeIndex;
			const refreshSourceCanvas = !showTradeDetails || mount.pinState.mode === "pinned"
				? mount.priceCanvas
				: mount.activeSourceCanvas;
			const refreshSourceChart = !showTradeDetails || mount.pinState.mode === "pinned"
				? mount.priceChart
				: mount.activeSourceChart;
			if (!chartsAlreadyResized) mount.priceChart.resize();
			if (showTradeDetails && !chartsAlreadyResized) mount.equityChart.resize();
			const stackRectAfterResize = mount.tradeChartStack.getBoundingClientRect();
			const pointerStillOverStack = isProbabilityHoverPointerOverStack(stackRectAfterResize);
			const previousViewportWidth = Number(
				mount.tradeChartStack.dataset.probabilityLayoutViewportWidth,
			);
			const viewportWidthChanged = Number.isFinite(previousViewportWidth)
				&& Math.abs(previousViewportWidth - window.innerWidth) > 1;
			mount.tradeChartStack.dataset.probabilityLayoutViewportWidth = String(window.innerWidth);
			// Keep a live pointer across vertical split changes so Home/End can
			// recompute overflow pan without another mousemove. A viewport-width
			// change invalidates client coordinates, so drop that pointer.
			if (!pointerStillOverStack || viewportWidthChanged) {
				mount.resetProbabilityHoverPointer();
			}
			mount.chartHoverPointCaches.clear();
			mount.probabilityHoverLayout = null;
			mount.probabilityModelCache.clear();
			mount.priceChartYPadding = resolvePriceChartYPadding();
			mount.applyBacktestYAxisScale(
				mount.priceChart,
				mount.priceCanvas,
				[mount.priceChart.data.datasets[0].data],
				mount.priceChartYPadding,
			);
			if (showTradeDetails) {
				mount.applyBacktestYAxisScale(
					mount.equityChart,
					mount.equityCanvas,
					[
						mount.equityChart.data.datasets[0].data,
						mount.equityChart.data.datasets[1].data,
						...(mount.hasLeveragedBenchmark ? [mount.equityChart.data.datasets[2].data] : []),
					],
					mount.chartYPaddingPx,
				);
			}
			if (Number.isInteger(refreshIndex) && refreshSourceCanvas && refreshSourceChart?.ctx) {
				if (pointerStillOverStack && !viewportWidthChanged && mount.pinState.mode !== "pinned") {
					const resizedIntersection = resolveProbabilityPointerIntersection(
						mount.probabilityHoverPointerX - stackRectAfterResize.left, stackRectAfterResize,
					)?.intersection;
					mount.probabilityHoverIntersection = resizedIntersection;
				}
				syncHoverState(refreshIndex, refreshSourceCanvas, refreshSourceChart);
				if (pointerStillOverStack && !viewportWidthChanged) {
					commitProbabilityPointerFrame();
				}
			} else {
				mount.priceChart.update("none");
				if (showTradeDetails) mount.equityChart.update("none");
			}
			mount.publishProbabilityStageMinimum();
			if (mount.strategyPresentation && mount.isProbabilityHistoryViewActive() && Number.isInteger(mount.latestProbabilityDetailIndex)) {
				const detailIndex = mount.latestProbabilityDetailIndex;
				const detailPoint = getDatasetPoint(mount.priceChart, detailIndex, 0);
				const detailModel = buildProbabilityGridModel(detailIndex, detailPoint);
				if (detailModel) mount.renderProbabilityDetail(detailIndex, detailModel);
				scheduleProbabilityDetailRefresh(2);
			}
		};
		const scheduleChartLayoutRefresh = () => {
			if (mount.layoutFrameId !== null || mount.controllerDestroyed) return;
			mount.layoutFrameId = mount.requestControllerAnimationFrame(() => {
				mount.layoutFrameId = null;
				refreshChartLayout();
			});
		};
		const refreshAfterSharedChartResize = () => {
			if (mount.layoutFrameId !== null) {
				mount.cancelControllerAnimationFrame(mount.layoutFrameId);
				mount.layoutFrameId = null;
			}
			refreshChartLayout({chartsAlreadyResized: true});
		};
		mount.bootstrap.backtestChartLayoutRefresh = refreshAfterSharedChartResize;
		window.addEventListener("resize", scheduleChartLayoutRefresh, {signal: mount.documentController.signal});
		window.addEventListener(
			"worthward:backtest-trade-details-change",
			scheduleChartLayoutRefresh,
			{signal: mount.documentController.signal},
		);
		scheduleChartLayoutRefresh();
		const clearPinnedProbabilityField = () => {
			if (mount.pinState.mode !== "pinned") return;
			mount.pinState = mount.probabilityGridApi.reducePinState?.(mount.pinState, {type: "clear"})
				|| {mode: "tracking", activeIndex: null};
			syncHoverState(null, mount.priceCanvas, mount.priceChart);
		};
		document.addEventListener("click", (event) => {
			if (mount.pinState.mode !== "pinned") return;
			const path = typeof event.composedPath === "function" ? event.composedPath() : [];
			if (path.includes(mount.priceCanvas) || (mount.probabilityTooltip && path.includes(mount.probabilityTooltip))) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest("button, a, input, select, textarea, [role='button'], [role='link']")) return;
			clearPinnedProbabilityField();
		}, {capture: true, signal: mount.documentController.signal});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape") clearPinnedProbabilityField();
		}, {signal: mount.documentController.signal});
		const hoverController = {
			update: scheduleChartLayoutRefresh,
			destroy() {
				if (mount.controllerDestroyed) return;
				mount.controllerDestroyed = true;
				cancelScheduledHoverSync();
				if (mount.pointerHoverFrameId !== null) {
					mount.cancelControllerAnimationFrame(mount.pointerHoverFrameId);
					mount.pointerHoverFrameId = null;
				}
				if (mount.layoutFrameId !== null) {
					mount.cancelControllerAnimationFrame(mount.layoutFrameId);
					mount.layoutFrameId = null;
				}
				if (mount.probabilityDetailRefreshFrameId !== null) {
					mount.cancelControllerAnimationFrame(mount.probabilityDetailRefreshFrameId);
					mount.probabilityDetailRefreshFrameId = null;
				}
				mount.probabilityDetailRefreshPasses = 0;
				mount.probabilityDetailLayoutObserver?.disconnect?.();
				mount.probabilityDetailLayoutObserver = null;
				mount.themeCleanup?.();
				mount.themeCleanup = null;
				mount.documentController.abort();
				mount.priceCanvas._abortController?.abort?.();
				mount.equityCanvas._abortController?.abort?.();
				mount.priceCanvas._abortController = null;
				mount.equityCanvas._abortController = null;
				mount.controllerAnimationFrames.forEach((frameId) => window.cancelAnimationFrame(frameId));
				mount.controllerAnimationFrames.clear();
				mount.controllerTaskCleanups.splice(0).forEach((cleanup) => cleanup());
				mount.probabilityScrollCleanup?.();
				mount.probabilityScrollCleanup = null;
				mount.probabilityScrollTarget = 0;
				mount.probabilityScrollVisualPosition = 0;
				mount.probabilityScrollVelocity = 0;
				mount.probabilityScrollLastTimestamp = null;
				mount.setProbabilityScrollPosition(0);
				mount.setProbabilityScrollPortActive(false);
				mount.clearProbabilityStageMinimum();
				mount.tradeChartStack.classList.remove("has-probability-field");
				delete mount.tradeChartStack.dataset.probabilityPanState;
				delete mount.tradeChartStack.dataset.probabilityPanTarget;
				delete mount.tradeChartStack.dataset.probabilityPanMotion;
				delete mount.tradeChartStack.dataset.probabilityPanVisualOffset;
				delete mount.tradeChartStack.dataset.probabilityPanVisualPosition;
				activateBacktestRows([], null);
				mount.hoverLine.remove();
				mount.hoverCrosshairLine.remove();
				mount.hoverDateLabel.remove();
				mount.fixedPriceAxis?.remove();
				mount.probabilityHint?.remove();
				mount.probabilityDetailPanel?.querySelector(".backtest-probability-empty-state")?.remove();
				mount.tradeChartStack.classList.remove("has-probability-overflow", "is-probability-dragging");
				mount.tooltip.remove();
				mount.probabilityTooltip?.remove();
				mount.probabilityScrollSpacer?.remove();
				mount.hideProbabilityDetail();
				mount.priceChart?.destroy?.();
				mount.equityChart?.destroy?.();
				if (mount.bootstrap.backtestChartLayoutRefresh === refreshAfterSharedChartResize) {
					delete mount.bootstrap.backtestChartLayoutRefresh;
				}
			},
		};
		mount.themeCleanup = mount.bindColorSchemeRefresh(() => {
			if (mount.controllerDestroyed || !mount.priceChart?.ctx || !mount.equityChart?.ctx) return;
			const nextTheme = mount.readThemeTokens();
			Object.assign(mount.resolvedTheme, nextTheme);
			const nextAllInPrimaryReferenceColor = nextTheme.muted;
			const nextAllInLeveragedReferenceColor = nextTheme.muted;
			mount.priceChart.options.scales.y.ticks.color = nextTheme.muted;
			mount.equityChart.options.scales.y.ticks.color = nextTheme.muted;
			mount.priceChart.data.datasets[0].borderColor = mount.isCandlestick ? "transparent" : nextTheme.accentPrimary;
			mount.priceChart.data.datasets[0].segment.borderColor = (context) => (
				mount.isSessionGap(context.p0DataIndex, context.p1DataIndex)
					? "rgba(0, 0, 0, 0)"
					: nextTheme.accentPrimary
			);
			mount.equityChart.data.datasets[1].borderColor = nextAllInPrimaryReferenceColor;
			mount.equityChart.data.datasets[1].segment.borderColor = (context) => (
				mount.isSessionGap(context.p0DataIndex, context.p1DataIndex)
					? "rgba(0, 0, 0, 0)"
					: nextAllInPrimaryReferenceColor
			);
			if (mount.hasLeveragedBenchmark && mount.equityChart.data.datasets[2]) {
				mount.equityChart.data.datasets[2].borderColor = nextAllInLeveragedReferenceColor;
				mount.equityChart.data.datasets[2].segment.borderColor = (context) => (
					mount.isSessionGap(context.p0DataIndex, context.p1DataIndex)
						? "rgba(0, 0, 0, 0)"
						: nextAllInLeveragedReferenceColor
				);
			}
			mount.priceChart.update("none");
			mount.equityChart.update("none");
		});
		initTransactionsPagination();
		if (refreshTransition) {
			const cleanupRefreshTransition = mount.animateBacktestRefreshTransition(
				mount.priceChart,
				mount.equityChart,
				refreshTransition,
				mount.close,
				mount.equity,
				mount.allInEquity,
				mount.allInLeveragedEquity,
				() => mount.priceChartYPadding,
				() => mount.chartYPaddingPx,
			);
			if (typeof cleanupRefreshTransition === "function") {
				mount.controllerTaskCleanups.push(cleanupRefreshTransition);
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
