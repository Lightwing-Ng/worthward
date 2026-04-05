/* Code version: v0.4.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const chartThemeState = bootstrap.chartThemeState = bootstrap.chartThemeState || {};

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
		if (chartThemeState.mediaCleanup) {
			chartThemeState.mediaCleanup();
			chartThemeState.mediaCleanup = null;
		}
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => window.requestAnimationFrame(callback);
		if (typeof media.addEventListener === "function") {
			media.addEventListener("change", handler);
			chartThemeState.mediaCleanup = () => media.removeEventListener("change", handler);
		} else if (typeof media.addListener === "function") {
			media.addListener(handler);
			chartThemeState.mediaCleanup = () => media.removeListener(handler);
		}
	};
	const consumeChartWorkspaceRefreshTransition = (viewName) => {
		const transition = bootstrap.chartWorkspaceRefreshTransition;
		if (!transition || transition.view !== viewName || !transition.labels?.length) return null;
		delete bootstrap.chartWorkspaceRefreshTransition;
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
			if (targetLabels.length === 1) return Number(sourceValues[sourceValues.length - 1] ?? fallbackValues?.[index] ?? 0);
			const ratio = index / Math.max(1, targetLabels.length - 1);
			const sourceIndex = Math.round(ratio * Math.max(0, sourceValues.length - 1));
			const candidate = Number(sourceValues[sourceIndex] ?? fallbackValues?.[index] ?? 0);
			return Number.isFinite(candidate) ? candidate : 0;
		});
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

	const renderReturnsChart = (config, data) => {
		const canvas = config?.canvas;
		const state = data?.state;
		if (!canvas || !state || !state.chart || !window.Chart) return null;
		const existingChart = window.Chart.getChart?.(canvas);
		if (existingChart) existingChart.destroy();

		const { chart: chartState, theme, chartConfig } = state;
		const resolvedTheme = readThemeTokens();
		const { series, profiles } = chartState;
		if (!series || !series.length) return;
		canvas.dataset.chartMounted = "1";
		const logoSize = 20;
		const logoGap = 8;
		const logoRightPadding = 12;
		const logoCache = new Map();

		const getLogoImage = (url, chartInstance) => {
			if (!url) return null;
			const cached = logoCache.get(url);
			if (cached) return cached;
			const image = new Image();
			image.decoding = "async";
			image.src = url;
			image.onload = () => chartInstance.update("none");
			image.onerror = () => logoCache.delete(url);
			logoCache.set(url, image);
			return image;
		};

		const labels = series[0].dates;
		const rawDates = Array.isArray(series[0].raw_dates) ? series[0].raw_dates : [];
		const refreshTransition = consumeChartWorkspaceRefreshTransition(state.currentView);
		const chartWrap = canvas.closest(".chart-wrap") || canvas.parentElement;
		const chartYPaddingPx = readPxToken(chartWrap, "--trade-chart-y-padding-px", 5);
		const previousSeriesMap = new Map((refreshTransition?.series || []).map((item) => [item.ticker, item]));
		const monthAbbreviations = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const portfolioLabelMap = {
			Portfolio: "Portfolio",
			SPY: "SPX",
			QQQ: "Nasdaq-100",
		};
		const glowPlugin = {
			id: "glowPlugin",
			beforeDatasetDraw(chartInstance, args) {
				const { ctx } = chartInstance;
				const dataset = chartInstance.data.datasets[args.index];
				ctx.save();
				ctx.shadowColor = dataset.glow === false ? "transparent" : dataset.shadowColor;
				ctx.shadowBlur = dataset.glow === false ? 0 : dataset.shadowBlur;
				ctx.shadowOffsetX = dataset.glow === false ? 0 : dataset.shadowOffsetX;
				ctx.shadowOffsetY = dataset.glow === false ? 0 : dataset.shadowOffsetY;
			},
			afterDatasetDraw(chartInstance) {
				chartInstance.ctx.restore();
			},
		};

		const zeroBandPlugin = {
			id: "zeroBandPlugin",
			beforeDatasetsDraw(chartInstance) {
				const { ctx, chartArea, scales } = chartInstance;
				const yScale = scales.y;
				if (!chartArea || !yScale) return;
				const zeroY = yScale.getPixelForValue(0);
				if (!Number.isFinite(zeroY)) return;
				const left = chartArea.left + 8;
				const right = chartArea.right - 8;
				if (left >= right) return;
				ctx.save();
				ctx.strokeStyle = chartConfig.zero_line_color || theme.muted;
				ctx.lineWidth = chartConfig.zero_line_width || 1;
				ctx.beginPath();
				ctx.moveTo(left, zeroY);
				ctx.lineTo(right, zeroY);
				ctx.stroke();
				ctx.restore();
			},
		};

		const xAxisLabelPlugin = {
			id: "xAxisLabelPlugin",
			afterDraw(chartInstance) {
				const { ctx, chartArea, scales } = chartInstance;
				const xScale = scales?.x;
				if (!chartArea || !xScale || !labels.length) return;
				const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
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
					const ratio = labels.length <= 1 ? 0 : index / (labels.length - 1);
					const x = chartArea.left + (chartArea.width * ratio);
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

		const hoverGuidePlugin = {
			id: "hoverGuidePlugin",
			afterDatasetsDraw(chartInstance) {
				const { ctx, chartArea, tooltip } = chartInstance;
				if (!chartArea || !tooltip || tooltip.opacity === 0) return;
				const x = tooltip.caretX;
				if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
				ctx.save();
				ctx.strokeStyle = chartConfig.zero_line_color || theme.muted;
				ctx.lineWidth = chartConfig.zero_line_width || 1;
				ctx.beginPath();
				ctx.moveTo(x, chartArea.top);
				ctx.lineTo(x, chartArea.bottom);
				ctx.stroke();
				ctx.restore();
			},
		};

		const lineEndLogoPlugin = {
			id: "lineEndLogoPlugin",
			afterDatasetsDraw(chartInstance) {
				const { ctx, chartArea } = chartInstance;
				if (!chartArea) return;
				chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
					const profile = profiles.find((item) => item.ticker === dataset.label);
					if (!profile?.logo_url) return;
					const meta = chartInstance.getDatasetMeta(datasetIndex);
					const lastPoint = meta?.data?.[meta.data.length - 1];
					if (!lastPoint) return;
					const image = getLogoImage(profile.logo_url, chartInstance);
					if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
					const centerX = chartArea.right + logoGap + (logoSize / 2);
					const centerY = lastPoint.y;
					const drawX = centerX - (logoSize / 2);
					const drawY = centerY - (logoSize / 2);
					const radius = 10;

					ctx.save();
					ctx.beginPath();
					ctx.moveTo(drawX + radius, drawY);
					ctx.arcTo(drawX + logoSize, drawY, drawX + logoSize, drawY + logoSize, radius);
					ctx.arcTo(drawX + logoSize, drawY + logoSize, drawX, drawY + logoSize, radius);
					ctx.arcTo(drawX, drawY + logoSize, drawX, drawY, radius);
					ctx.arcTo(drawX, drawY, drawX + logoSize, drawY, radius);
					ctx.closePath();
					ctx.clip();
					ctx.drawImage(image, drawX, drawY, logoSize, logoSize);
					ctx.restore();
				});
			},
		};

		try {
			Chart.register(glowPlugin, zeroBandPlugin, hoverGuidePlugin, lineEndLogoPlugin, xAxisLabelPlugin);
		} catch (e) {
			// ignore registration error
		}

		const getOrCreateTooltip = (chart) => {
			const parent = chart.canvas.parentNode;
			let tooltip = parent.querySelector(".chart-tooltip");
			if (tooltip) return tooltip;
			tooltip = document.createElement("div");
			tooltip.className = "chart-tooltip";
			tooltip.innerHTML = '<p class="chart-tooltip-date"></p><div class="chart-tooltip-list"></div>';
			parent.appendChild(tooltip);
			return tooltip;
		};

		const externalTooltipHandler = ({ chart, tooltip }) => {
			const tooltipEl = getOrCreateTooltip(chart);
			if (tooltip.opacity === 0) {
				tooltipEl.classList.remove("is-visible");
				return;
			}
			const dateEl = tooltipEl.querySelector(".chart-tooltip-date");
			const listEl = tooltipEl.querySelector(".chart-tooltip-list");
			if (tooltip.dataPoints?.length) {
				const pointIndex = tooltip.dataPoints[0].dataIndex;
				const parsedDate = parseRawDate(rawDates[pointIndex]);
				dateEl.textContent = parsedDate ? formatChartDate(parsedDate) : (tooltip.title?.[0] || "");
			}

			const bodyLines = tooltip.dataPoints.map((point) => {
				const profile = profiles.find((item) => item.ticker === point.dataset.label);
				return {
					color: point.dataset.borderColor,
					label: state.currentView === "portfolio" ? (portfolioLabelMap[point.dataset.label] || point.dataset.label) : point.dataset.label,
					logoUrl: profile?.logo_url || "",
					value: `${point.parsed.y.toFixed(2)}%`,
				};
			});

			listEl.innerHTML = bodyLines.map((item) => `
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot" style="background:${item.color}"></span>
					${item.logoUrl ? `<img class="chart-tooltip-logo" src="${item.logoUrl}" alt="${item.label} logo">` : "<span></span>"}
					<span class="chart-tooltip-label">${item.label}</span>
					<span class="chart-tooltip-value">${item.value}</span>
				</div>
			`).join("");

			const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
			tooltipEl.classList.add("is-visible");

			const parentRect = chart.canvas.parentNode.getBoundingClientRect();
			const tooltipRect = tooltipEl.getBoundingClientRect();
			const padding = 12;
			const gap = 14;
			const anchorX = positionX + tooltip.caretX;
			const anchorY = positionY + tooltip.caretY;
			const roomRight = parentRect.width - anchorX - padding;
			const roomLeft = anchorX - padding;
			const preferRight = roomRight >= tooltipRect.width + gap || roomRight >= roomLeft;
			let left = preferRight ? anchorX + gap : anchorX - tooltipRect.width - gap;
			if (left < padding) left = padding;
			if (left + tooltipRect.width > parentRect.width - padding) left = parentRect.width - tooltipRect.width - padding;
			let top = anchorY - (tooltipRect.height / 2);
			if (top < padding) top = padding;
			if (top + tooltipRect.height > parentRect.height - padding) top = parentRect.height - tooltipRect.height - padding;
			tooltipEl.style.left = `${left}px`;
			tooltipEl.style.top = `${top}px`;
		};

		const referenceLineWidth = 2.5;

		const baseDatasetStyle = {
			borderWidth: referenceLineWidth,
			pointRadius: 0,
			pointHoverRadius: chartConfig.point_hover_radius,
			pointHitRadius: chartConfig.point_hit_radius,
			pointHoverBorderWidth: 0,
			tension: 0,
			borderJoinStyle: "round",
			borderCapStyle: "round",
			shadowOffsetX: 0,
			shadowOffsetY: 0,
			shadowBlur: chartConfig.shadow_blur,
			fill: false,
			backgroundColor: "transparent",
		};

		const hexToRgba = (hex, alpha) => {
			const raw = hex.replace("#", "");
			const r = parseInt(raw.substring(0, 2), 16);
			const g = parseInt(raw.substring(2, 4), 16);
			const b = parseInt(raw.substring(4, 6), 16);
			return `rgba(${r}, ${g}, ${b}, ${alpha})`;
		};

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

		const targetSeriesByIndex = series.map((item) => item.normalized_returns);
		const chartYScale = buildPixelPaddedYScale(canvas, targetSeriesByIndex, chartYPaddingPx);
		const chart = new Chart(canvas, {
			type: "line",
			data: {
				labels,
				datasets: series.map((item, index) => ({
					...baseDatasetStyle,
					label: item.ticker,
					data: refreshTransition
						? buildAlignedSeries(
							previousSeriesMap.get(item.ticker)?.dates || refreshTransition.labels,
							previousSeriesMap.get(item.ticker)?.values || [],
							labels,
							item.normalized_returns,
						)
						: item.normalized_returns,
					borderColor: item.color || resolvedTheme.accentPrimary || theme.accent_primary,
					pointHoverBackgroundColor: item.color || resolvedTheme.accentPrimary || theme.accent_primary,
					shadowColor: hexToRgba(item.color || resolvedTheme.accentPrimary || theme.accent_primary, 0.4),
					glow: item.glow !== false,
					shadowBlur: item.glow === false ? 0 : chartConfig.shadow_blur,
				})),
			},
			options: {
				animation: refreshTransition ? false : undefined,
				responsive: true,
				maintainAspectRatio: false,
				layout: { padding: { top: 8, right: logoSize + logoGap + logoRightPadding, bottom: 22, left: 4 } },
				interaction: { mode: "index", intersect: false },
				hover: { mode: "index", intersect: false },
				onHover(_event, activeElements, chartInstance) {
					const activeIndexes = new Set(activeElements.map((item) => item.datasetIndex));
					chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
						if (activeIndexes.size === 0) {
							dataset.borderWidth = referenceLineWidth;
							dataset.shadowBlur = dataset.glow === false ? 0 : chartConfig.shadow_blur;
						} else if (activeIndexes.has(datasetIndex)) {
							dataset.borderWidth = referenceLineWidth;
							dataset.shadowBlur = dataset.glow === false ? 0 : chartConfig.shadow_blur_active;
						} else {
							dataset.borderWidth = referenceLineWidth;
							dataset.shadowBlur = dataset.glow === false ? 0 : chartConfig.shadow_blur_inactive;
						}
					});
					chartInstance.update("none");
				},
				plugins: { tooltip: { enabled: false, external: externalTooltipHandler }, legend: { display: false } },
				scales: {
					x: {
						grid: { display: false, drawBorder: false },
						border: { display: false },
						ticks: { display: false },
					},
					y: {
						bounds: "ticks",
						...chartYScale,
						grid: { display: false, drawBorder: false },
						border: { display: false },
						ticks: {
							color: resolvedTheme.muted,
							padding: 10,
							font: { family: 'GDS Transport, Helvetica Neue, Arial, sans-serif', size: 12 },
							callback(value, index, ticks) {
								if (index === 0 || index === ticks.length - 1) return "";
								return `${value}%`;
							},
						},
					},
				},
			},
		});
		bindColorSchemeRefresh(() => {
			const nextTheme = readThemeTokens();
			chart.options.scales.y.ticks.color = nextTheme.muted;
			chart.data.datasets.forEach((dataset, index) => {
				const seriesItem = series[index] || {};
				const strokeColor = seriesItem.color || nextTheme.accentPrimary || theme.accent_primary;
				dataset.borderColor = strokeColor;
				dataset.pointHoverBackgroundColor = strokeColor;
				dataset.shadowColor = hexToRgba(strokeColor, 0.4);
			});
			chart.update();
		});
		if (refreshTransition) {
			window.requestAnimationFrame(() => {
				chart.options.animation = {
					duration: 540,
					easing: "easeOutCubic",
				};
				chart.data.datasets.forEach((dataset, index) => {
					dataset.data = targetSeriesByIndex[index];
				});
				chart.update();
			});
		}
		return chart;
	};

	const initChartWorkspace = () => {
		const state = window.ANTIGRAVITY_APP;
		const canvas = document.getElementById("returnsChart");
		if (!state || !state.chart || !canvas) return;
		renderReturnsChart({ canvas }, { state });
	};

	bootstrap.renderReturnsChart = renderReturnsChart;
	bootstrap.initChartWorkspace = initChartWorkspace;
	initChartWorkspace();
})();
