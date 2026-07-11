/* Code version: v0.2.1 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const state = window.ANTIGRAVITY_APP;
	if (!state) return;

	const REFRESH_MS = 45000;
	const Y_AXIS_WIDTH = 78;
	const LOGO_SIZE = 20;
	const RIGHT_GUTTER = 44;
	const imageCache = new Map();
	const priceCharts = new Map();
	let refreshTimer = 0;
	let sharedHoverIndex = -1;

	const currencyForTicker = (ticker) => {
		const normalized = String(ticker || "").trim().toUpperCase();
		const mappings = [
			[[".HK"], "HKD"],
			[[".SH", ".SS", ".SZ"], "CNY"],
			[[".T", ".JP"], "JPY"],
			[[".SG", ".SI"], "SGD"],
			[[".L"], "GBP"],
			[[".KS", ".KQ"], "KRW"],
			[[".TW", ".TWO"], "TWD"],
			[[".AX"], "AUD"],
			[[".TO", ".V", ".NE", ".CN", ".CA"], "CAD"],
		];
		return mappings.find(([suffixes]) => suffixes.some((suffix) => normalized.endsWith(suffix)))?.[1] || "USD";
	};

	const finiteNumber = (value) => {
		if (value === null || value === undefined || value === "") return null;
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	};

	const parseRawMinute = (value) => {
		const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
		if (!match) return null;
		return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])) / 60000);
	};

	const formatXAxisValue = (rawValue, intraday) => {
		const match = String(rawValue || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
		if (!match) return "";
		if (intraday && match[4]) return `${match[4]}:${match[5]}`;
		return `${match[3]} ${new Date(Date.UTC(2000, Number(match[2]) - 1, 1)).toLocaleString("en-US", {month: "short", timeZone: "UTC"})}`;
	};

	const formatPrice = (value, currency, showCurrency) => {
		const numeric = finiteNumber(value);
		if (numeric === null) return "";
		const absolute = Math.abs(numeric);
		const digits = absolute >= 1000 ? 0 : absolute >= 100 ? 1 : 2;
		const formatted = numeric.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits});
		return showCurrency ? `${currency} ${formatted}` : formatted;
	};

	const readTheme = () => {
		const computed = getComputedStyle(document.body);
		return {
			text: computed.getPropertyValue("--theme-text").trim(),
			muted: computed.getPropertyValue("--theme-muted").trim(),
			accent: computed.getPropertyValue("--theme-accent-primary").trim(),
		};
	};

	const loadLogo = (url, chart) => {
		if (!url) return null;
		if (imageCache.has(url)) return imageCache.get(url);
		const image = new Image();
		image.decoding = "async";
		image.onload = () => {
			if (!chart.canvas?.isConnected || window.Chart?.getChart?.(chart.canvas) !== chart) return;
			chart.update("none");
		};
		image.onerror = () => imageCache.delete(url);
		image.src = url;
		imageCache.set(url, image);
		return image;
	};

	const drawContainedLogo = (ctx, image, drawX, drawY, boxSize, padding = 2) => {
		const sourceWidth = Number(image?.naturalWidth || 0);
		const sourceHeight = Number(image?.naturalHeight || 0);
		if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return;
		const contentSize = Math.max(1, boxSize - (Math.max(0, padding) * 2));
		const scale = Math.min(contentSize / sourceWidth, contentSize / sourceHeight);
		const drawWidth = sourceWidth * scale;
		const drawHeight = sourceHeight * scale;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(
			image,
			drawX + ((boxSize - drawWidth) / 2),
			drawY + ((boxSize - drawHeight) / 2),
			drawWidth,
			drawHeight,
		);
	};

	const destroyPriceCharts = () => {
		document.querySelectorAll("[data-price-subplot-canvas]").forEach((canvas) => {
			canvas.onmouseleave = null;
			window.Chart?.getChart?.(canvas)?.destroy();
		});
		priceCharts.clear();
		sharedHoverIndex = -1;
	};

	const escapeTooltipHtml = (value) => String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

	const formatSharedTooltipDate = (value) => {
		const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
		if (!match) return String(value || "");
		const month = new Date(Date.UTC(2000, Number(match[2]) - 1, 1)).toLocaleString("en-US", {month: "short", timeZone: "UTC"});
		const date = `${Number(match[3])} ${month} ${match[1]}`;
		return match[4] && `${match[4]}:${match[5]}` !== "00:00"
			? `${date} · ${match[4]}:${match[5]} New York`
			: date;
	};

	const getOrCreateSharedTooltip = () => {
		const surface = document.querySelector(".price-subplots-surface");
		if (!(surface instanceof HTMLElement)) return null;
		let tooltip = surface.querySelector(".price-shared-tooltip");
		if (tooltip instanceof HTMLElement) return tooltip;
		tooltip = document.createElement("div");
		tooltip.className = "chart-tooltip price-shared-tooltip";
		tooltip.innerHTML = '<div class="chart-tooltip-date"></div><div class="chart-tooltip-list"></div>';
		surface.appendChild(tooltip);
		return tooltip;
	};

	const drawSharedHoverGuides = () => {
		priceCharts.forEach((chart) => {
			if (!chart.canvas?.isConnected || window.Chart?.getChart?.(chart.canvas) !== chart) return;
			chart.draw();
		});
	};

	const hideSharedHover = () => {
		if (sharedHoverIndex < 0 && !document.querySelector(".price-shared-tooltip.is-visible")) return;
		sharedHoverIndex = -1;
		document.querySelector(".price-shared-tooltip")?.classList.remove("is-visible");
		drawSharedHoverGuides();
	};

	const updateSharedHover = (dataIndex, sourceChart, event, {series, profiles, currencies, showCurrency}) => {
		if (!Number.isInteger(dataIndex) || dataIndex < 0 || !(sourceChart?.canvas instanceof HTMLCanvasElement)) {
			hideSharedHover();
			return;
		}
		sharedHoverIndex = dataIndex;
		const tooltip = getOrCreateSharedTooltip();
		const surface = tooltip?.parentElement;
		if (!(tooltip instanceof HTMLElement) || !(surface instanceof HTMLElement)) return;
		const rawDates = Array.isArray(series[0]?.raw_dates) ? series[0].raw_dates : [];
		const fallbackDates = Array.isArray(series[0]?.dates) ? series[0].dates : [];
		const rawDate = rawDates[dataIndex] || fallbackDates[dataIndex] || "";
		const dateElement = tooltip.querySelector(".chart-tooltip-date");
		const listElement = tooltip.querySelector(".chart-tooltip-list");
		if (dateElement) dateElement.textContent = formatSharedTooltipDate(rawDate);
		if (listElement) {
			listElement.innerHTML = series.map((item, index) => {
				const profile = profiles.find((candidate) => candidate.ticker === item.ticker) || {};
				const price = Array.isArray(item.prices) ? item.prices[dataIndex] : null;
				const value = finiteNumber(price);
				return `
					<div class="chart-tooltip-row">
						<span class="chart-tooltip-dot" style="background:${escapeTooltipHtml(item.color || "currentColor")}"></span>
						${profile.logo_url ? `<img class="chart-tooltip-logo" src="${escapeTooltipHtml(profile.logo_url)}" alt="">` : "<span></span>"}
						<span class="chart-tooltip-label">${escapeTooltipHtml(item.ticker)}</span>
						<span class="chart-tooltip-value">${value === null ? "—" : escapeTooltipHtml(formatPrice(value, currencies[index], showCurrency))}</span>
					</div>
				`;
			}).join("");
		}

		tooltip.classList.add("is-visible");
		const surfaceRect = surface.getBoundingClientRect();
		const canvasRect = sourceChart.canvas.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const anchorX = canvasRect.left - surfaceRect.left + sourceChart.scales.x.getPixelForValue(dataIndex);
		const pointerY = Number.isFinite(event?.y) ? event.y : sourceChart.chartArea.top;
		const anchorY = canvasRect.top - surfaceRect.top + pointerY;
		const padding = 12;
		const gap = 14;
		const roomRight = surfaceRect.width - anchorX - padding;
		const preferRight = roomRight >= tooltipRect.width + gap || roomRight >= anchorX;
		let left = preferRight ? anchorX + gap : anchorX - tooltipRect.width - gap;
		left = Math.max(padding, Math.min(left, surfaceRect.width - tooltipRect.width - padding));
		let top = anchorY - (tooltipRect.height / 2);
		top = Math.max(padding, Math.min(top, surfaceRect.height - tooltipRect.height - padding));
		tooltip.style.left = `${Math.round(left)}px`;
		tooltip.style.top = `${Math.round(top)}px`;
		drawSharedHoverGuides();
	};

	const renderPriceSubplots = () => {
		if (state.currentView !== "prices" || !window.Chart) return;
		const series = Array.isArray(state.chart?.series) ? state.chart.series : [];
		const profiles = Array.isArray(state.chart?.profiles) ? state.chart.profiles : [];
		const currencies = series.map((item) => currencyForTicker(item.ticker));
		const showCurrency = new Set(currencies).size > 1;
		const theme = readTheme();
		hideSharedHover();
		destroyPriceCharts();

		document.querySelectorAll("[data-price-subplot-canvas]").forEach((canvas) => {
			const index = Number.parseInt(canvas.dataset.seriesIndex || "", 10);
			const item = series[index];
			if (!item) return;
			const prices = Array.isArray(item.prices) ? item.prices.map(finiteNumber) : [];
			const rawDates = Array.isArray(item.raw_dates) ? item.raw_dates : [];
			const labels = rawDates.length ? rawDates : (item.dates || []);
			const validIndexes = prices.flatMap((value, valueIndex) => value === null ? [] : [valueIndex]);
			if (!validIndexes.length) return;
			const firstIndex = validIndexes[0];
			const lastIndex = validIndexes[validIndexes.length - 1];
			const lastPrice = prices[lastIndex];
			const currency = currencies[index];
			const intraday = rawDates.some((value) => /[ T]\d{2}:\d{2}$/.test(String(value)) && !/[ T]00:00$/.test(String(value)));
			const profile = profiles.find((candidate) => candidate.ticker === item.ticker) || {};

			const fixedScaleWidthPlugin = {
				id: `priceFixedScaleWidth${index}`,
				beforeUpdate(chart) {
					if (chart.options.scales?.y) chart.options.scales.y.afterFit = (scale) => { scale.width = Y_AXIS_WIDTH; };
				},
			};
			const closingLogoPlugin = {
				id: `priceClosingLogo${index}`,
				afterDatasetsDraw(chart) {
					const image = loadLogo(profile.logo_url, chart);
					if (!image?.complete || !image.naturalWidth || !chart.chartArea || lastPrice === null) return;
					const centerX = chart.chartArea.right + 10 + (LOGO_SIZE / 2);
					const centerY = chart.scales.y.getPixelForValue(lastPrice);
					const drawX = centerX - (LOGO_SIZE / 2);
					const drawY = centerY - (LOGO_SIZE / 2);
					chart.ctx.save();
					chart.ctx.fillStyle = "#fff";
					chart.ctx.beginPath();
					chart.ctx.arc(centerX, centerY, LOGO_SIZE / 2, 0, Math.PI * 2);
					chart.ctx.fill();
					drawContainedLogo(chart.ctx, image, drawX, drawY, LOGO_SIZE);
					chart.ctx.restore();
				},
			};
			const sharedHoverGuidePlugin = {
				id: `priceSharedHoverGuide${index}`,
				afterDatasetsDraw(chart) {
					if (sharedHoverIndex < 0 || !chart.chartArea || !chart.scales?.x) return;
					const x = chart.scales.x.getPixelForValue(sharedHoverIndex);
					if (!Number.isFinite(x) || x < chart.chartArea.left || x > chart.chartArea.right) return;
					chart.ctx.save();
					chart.ctx.strokeStyle = theme.muted;
					chart.ctx.globalAlpha = 0.72;
					chart.ctx.lineWidth = 1;
					chart.ctx.beginPath();
					chart.ctx.moveTo(x, chart.chartArea.top);
					chart.ctx.lineTo(x, chart.chartArea.bottom);
					chart.ctx.stroke();
					chart.ctx.restore();
				},
			};

			const chart = new Chart(canvas, {
				type: "line",
				data: {
					labels,
					datasets: [{
						label: item.ticker,
						data: prices,
						borderColor: item.color || theme.accent,
						borderWidth: 1.5,
						pointRadius: 0,
						pointHitRadius: 12,
						pointHoverRadius: 3,
						tension: 0,
						spanGaps: false,
						segment: {
							borderColor(context) {
								if (!intraday) return item.color || theme.accent;
								const left = parseRawMinute(rawDates[context.p0DataIndex]);
								const right = parseRawMinute(rawDates[context.p1DataIndex]);
								return Number.isFinite(left) && Number.isFinite(right) && right - left > 5
									? "transparent"
									: item.color || theme.accent;
							},
						},
					}],
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					animation: false,
					layout: {padding: {top: 8, right: RIGHT_GUTTER, bottom: 4, left: 0}},
					interaction: {mode: "index", intersect: false},
					onHover(event, activeElements, chartInstance) {
						if (!activeElements.length) {
							hideSharedHover();
							return;
						}
						updateSharedHover(activeElements[0].index, chartInstance, event, {
							series,
							profiles,
							currencies,
							showCurrency,
						});
					},
					plugins: {
						legend: {display: false},
						tooltip: {enabled: false},
					},
					scales: {
						x: {
							grid: {display: false},
							border: {display: false},
							ticks: {
								autoSkip: false,
								maxRotation: 0,
								color: theme.muted,
								callback(_value, tickIndex) {
									return tickIndex === firstIndex || tickIndex === lastIndex
										? formatXAxisValue(rawDates[tickIndex], intraday)
										: "";
								},
							},
						},
						y: {
							grid: {display: false},
							border: {display: false},
							ticks: {
								color: theme.muted,
								padding: 8,
								callback: (value) => formatPrice(value, currency, showCurrency),
							},
						},
					},
				},
				plugins: [fixedScaleWidthPlugin, closingLogoPlugin, sharedHoverGuidePlugin],
			});
			priceCharts.set(index, chart);
			canvas.onmouseleave = hideSharedHover;
		});
	};

	const formatLocalIsoDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	const refreshLivePrices = async () => {
		if (state.currentView !== "prices") return;
		const pageParams = new URLSearchParams(window.location.search);
		const period = (pageParams.get("period") || "").toLowerCase();
		const rangeMode = (pageParams.get("range") || "period").toLowerCase();
		if (!state.endpoints?.compareLive || !["1d", "3d", "1w"].includes(period)) return;
		if (rangeMode === "exact" && period !== "1d") return;
		const params = new URLSearchParams();
		(state.chart?.series || []).forEach((item) => params.append("ticker", item.ticker));
		params.set("period", period);
		params.set("live_date", formatLocalIsoDate());
		if (rangeMode === "exact") params.set("axis_date", state.chart?.tradingDate || pageParams.get("trading_date") || "");
		if (pageParams.get("extended_hours") === "1") params.set("extended_hours", "1");
		params.set("refresh", "1");
		try {
			const response = await fetch(`${state.endpoints.compareLive}?${params.toString()}`, {headers: {Accept: "application/json"}});
			const payload = await response.json();
			if (!response.ok || !payload.success || !Array.isArray(payload.series)) return;
			state.chart.series = payload.series;
			renderPriceSubplots();
		} catch (_error) {
		}
	};

	bootstrap.initPriceCompareWorkspace = () => {
		renderPriceSubplots();
		if (!refreshTimer) refreshTimer = window.setInterval(refreshLivePrices, REFRESH_MS);
	};
	window.addEventListener("beforeunload", () => {
		if (refreshTimer) window.clearInterval(refreshTimer);
		destroyPriceCharts();
	}, {once: true});
	window.addEventListener("antigravity:theme-mode-change", () => window.requestAnimationFrame(renderPriceSubplots));
})();
