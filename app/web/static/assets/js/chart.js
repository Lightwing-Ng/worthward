/* Code version: v3.0.3 */
(() => {
	const state = window.ANTIGRAVITY_APP;
	if (!state || !state.chart || !window.Chart) return;

	const { chart: chartState, theme, chartConfig } = state;
	const { series, profiles } = chartState;
	if (!series || !series.length) return;

	const labels = series[0].dates;
	const glowPlugin = {
		id: "glowPlugin",
		beforeDatasetDraw(chartInstance, args) {
			const { ctx } = chartInstance;
			ctx.save();
			ctx.shadowColor = chartInstance.data.datasets[args.index].shadowColor;
			ctx.shadowBlur = chartInstance.data.datasets[args.index].shadowBlur;
			ctx.shadowOffsetX = chartInstance.data.datasets[args.index].shadowOffsetX;
			ctx.shadowOffsetY = chartInstance.data.datasets[args.index].shadowOffsetY;
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

	Chart.register(glowPlugin, zeroBandPlugin, hoverGuidePlugin);

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
				label: point.dataset.label,
				logoUrl: profile?.logo_url || "",
				value: `${point.parsed.y.toFixed(2)}%`,
			};
		});

		listEl.innerHTML = bodyLines.map((item) => `
			<div class="chart-tooltip-row">
				<span class="chart-tooltip-dot" style="background:${item.color}"></span>
				${item.logoUrl ? `<img class="chart-tooltip-logo" src="${item.logoUrl}" alt="${item.label} logo">` : '<span></span>'}
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

	new Chart(document.getElementById("returnsChart"), {
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
			})),
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			layout: { padding: { top: 8, right: 6, bottom: 0, left: 4 } },
			interaction: { mode: "index", intersect: false },
			hover: { mode: "index", intersect: false },
			onHover(_event, activeElements, chartInstance) {
				const activeIndexes = new Set(activeElements.map((item) => item.datasetIndex));
				chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
					if (activeIndexes.size === 0) {
						dataset.borderWidth = chartConfig.line_width;
						dataset.shadowBlur = chartConfig.shadow_blur;
					} else if (activeIndexes.has(datasetIndex)) {
						dataset.borderWidth = chartConfig.line_width_active;
						dataset.shadowBlur = chartConfig.shadow_blur_active;
					} else {
						dataset.borderWidth = chartConfig.line_width_inactive;
						dataset.shadowBlur = chartConfig.shadow_blur_inactive;
					}
				});
				chartInstance.update("none");
			},
			plugins: { tooltip: { enabled: false, external: externalTooltipHandler }, legend: { display: false } },
			scales: {
				x: { grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { color: theme.muted, padding: 10, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { family: 'GDS Transport, Helvetica Neue, Arial, sans-serif', size: 12, weight: "700" } } },
				y: { grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { color: theme.muted, padding: 10, font: { family: 'GDS Transport, Helvetica Neue, Arial, sans-serif', size: 12 }, callback(value) { return `${value}%`; } } },
			},
		},
	});
})();
