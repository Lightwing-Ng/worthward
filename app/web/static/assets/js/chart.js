/* Code version: v3.2.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

	const initChartWorkspace = () => {
		const state = window.ANTIGRAVITY_APP;
		if (!state || !state.chart || !window.Chart) return;
		const canvas = document.getElementById("returnsChart");
		if (!canvas) return;
		const existingChart = window.Chart.getChart?.(canvas);
		if (existingChart) existingChart.destroy();

		const { chart: chartState, theme, chartConfig } = state;
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
			image.onload = () => chartInstance.draw();
			image.onerror = () => logoCache.delete(url);
			logoCache.set(url, image);
			return image;
		};

		const labels = series[0].dates;
		const dateLabelFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
		const shortDateLabelFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
		const yearLabelFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" });
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
			Chart.register(glowPlugin, zeroBandPlugin, hoverGuidePlugin, lineEndLogoPlugin);
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
			if (tooltip.title?.length) [dateEl.textContent] = tooltip.title;

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

		const baseDatasetStyle = {
			borderWidth: chartConfig.line_width,
			pointRadius: 0,
			pointHoverRadius: chartConfig.point_hover_radius,
			pointHitRadius: chartConfig.point_hit_radius,
			pointHoverBorderWidth: 0,
			tension: 0.2,
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

		const parseLabelDate = (value) => {
			const parsed = new Date(value);
			return Number.isNaN(parsed.getTime()) ? null : parsed;
		};

		const buildAdaptiveTickLabel = (scale, index, ticks) => {
			const tickLabel = labels[index];
			if (!tickLabel) return "";
			const parsedDate = parseLabelDate(tickLabel);
			if (!parsedDate) return tickLabel;
			const plotWidth = scale.chart?.chartArea?.width || scale.chart?.width || 0;
			const tickCount = Math.max(1, ticks.length);
			const slotWidth = plotWidth / tickCount;
			const showEvery = slotWidth >= 112 ? 1 : slotWidth >= 76 ? 2 : 3;
			const isLastTick = index === ticks.length - 1;
			if (index % showEvery !== 0 && !isLastTick) return "";
			if (slotWidth >= 112) return dateLabelFormatter.format(parsedDate);
			return [shortDateLabelFormatter.format(parsedDate), yearLabelFormatter.format(parsedDate)];
		};

		new Chart(canvas, {
			type: "line",
			data: {
				labels,
				datasets: series.map((item, index) => ({
					...baseDatasetStyle,
					label: item.ticker,
					data: item.normalized_returns,
					borderColor: item.color || theme.accent_primary,
					pointHoverBackgroundColor: item.color || theme.accent_primary,
					shadowColor: hexToRgba(item.color || theme.accent_primary, 0.4),
					glow: item.glow !== false,
					shadowBlur: item.glow === false ? 0 : chartConfig.shadow_blur,
				})),
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: { padding: { top: 8, right: logoSize + logoGap + logoRightPadding, bottom: 8, left: 4 } },
				interaction: { mode: "index", intersect: false },
				hover: { mode: "index", intersect: false },
				onHover(_event, activeElements, chartInstance) {
					const activeIndexes = new Set(activeElements.map((item) => item.datasetIndex));
					chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
						if (activeIndexes.size === 0) {
							dataset.borderWidth = chartConfig.line_width;
							dataset.shadowBlur = dataset.glow === false ? 0 : chartConfig.shadow_blur;
						} else if (activeIndexes.has(datasetIndex)) {
							dataset.borderWidth = chartConfig.line_width_active;
							dataset.shadowBlur = dataset.glow === false ? 0 : chartConfig.shadow_blur_active;
						} else {
							dataset.borderWidth = chartConfig.line_width_inactive;
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
						ticks: {
							color: theme.muted,
							padding: 10,
							maxRotation: 0,
							autoSkip: false,
							font: { family: 'GDS Transport, Helvetica Neue, Arial, sans-serif', size: 12, weight: "700" },
							callback(value, index, ticks) {
								return buildAdaptiveTickLabel(this, index, ticks);
							},
						},
					},
					y: { grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { color: theme.muted, padding: 10, font: { family: 'GDS Transport, Helvetica Neue, Arial, sans-serif', size: 12 }, callback(value) { return `${value}%`; } } },
				},
			},
		});
	};

	bootstrap.initChartWorkspace = initChartWorkspace;
	initChartWorkspace();
})();
