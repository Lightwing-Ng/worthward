/* Code version: v0.11.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const state = window.ANTIGRAVITY_APP;
	if (!state) return;

	const REFRESH_MS = 45000;
	const Y_AXIS_WIDTH = 92;
	const LOGO_SIZE = 20;
	const RIGHT_GUTTER = 44;
	const imageCache = new Map();
	const priceCharts = new Map();
	let refreshTimer = 0;
	let liveRequestSerial = 0;
	let liveRequestController = null;
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

	const formatXAxisDate = (rawValue) => {
		const match = String(rawValue || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!match) return "";
		const dateParts = {
			year: Number(match[1]),
			monthIndex: Number(match[2]) - 1,
			day: Number(match[3]),
		};
		if (typeof bootstrap.dateDisplay?.formatFullDateParts === "function") {
			return bootstrap.dateDisplay.formatFullDateParts(dateParts);
		}
		const month = new Date(Date.UTC(2000, dateParts.monthIndex, 1)).toLocaleString("en-US", {month: "short", timeZone: "UTC"});
		return `${dateParts.day} ${month} ${dateParts.year}`;
	};

	const formatSingleDayXAxisValue = (rawValue) => [
		formatXAxisValue(rawValue, true),
		formatXAxisDate(rawValue),
	];

	const buildIntradayDayGroups = (rawDates) => {
		const groups = [];
		rawDates.forEach((value, index) => {
			const dateKey = String(value || "").slice(0, 10);
			if (!dateKey) return;
			const current = groups[groups.length - 1];
			if (current?.dateKey === dateKey) {
				current.endIndex = index;
				return;
			}
			groups.push({dateKey, startIndex: index, endIndex: index});
		});
		return groups;
	};

	const marketForTicker = (ticker) => {
		const normalized = String(ticker || "").trim().toUpperCase();
		if (normalized.endsWith(".HK")) return "HK";
		if (normalized.endsWith(".KS") || normalized.endsWith(".KQ")) return "KR";
		if (normalized.endsWith(".L")) return "UK";
		return "US";
	};

	const timezoneForMarket = (market) => ({
		HK: "Asia/Hong_Kong",
		KR: "Asia/Seoul",
		UK: "Europe/London",
		US: "America/New_York",
	}[market] || "America/New_York");

	const timezoneLabel = (timezone, offsetMinutes) => {
		if (timezone === "Asia/Hong_Kong") return "HKT";
		if (timezone === "Asia/Seoul") return "KST";
		if (timezone === "Europe/London") return Number(offsetMinutes) === 60 ? "BST" : "GMT";
		if (timezone === "America/New_York") return Number(offsetMinutes) === -240 ? "EDT" : "EST";
		return timezone;
	};

	const dateSerial = (parts) => Math.floor(Date.UTC(parts.year, parts.monthIndex, parts.day) / 86400000);

	const buildMarketSessionEvents = (rawDates, tickers) => {
		const markets = new Set((tickers || []).map(marketForTicker));
		if (markets.size <= 1) return [];
		const eventDefinitions = [
			{market: "KR", timezone: "Asia/Seoul", hours: 9, minutes: 0, label: "South Korea open"},
			{market: "UK", timezone: "Europe/London", hours: 8, minutes: 0, label: "London open"},
			{market: "HK", timezone: "Asia/Hong_Kong", hours: 16, minutes: 0, label: "Hong Kong close"},
			{market: "KR", timezone: "Asia/Seoul", hours: 15, minutes: 30, label: "South Korea close"},
			{market: "US", timezone: "America/New_York", hours: 4, minutes: 0, label: "US pre-market open"},
		];
		return eventDefinitions
			.filter((event) => markets.has(event.market))
			.map((event) => {
				const index = rawDates.findIndex((rawDate) => {
					const parts = bootstrap.dateDisplay?.convertNewYorkWallTimeParts?.(rawDate, event.timezone);
					return parts?.hours === event.hours && parts?.minutes === event.minutes;
				});
				if (index < 0) return null;
				const parts = bootstrap.dateDisplay.convertNewYorkWallTimeParts(rawDates[index], event.timezone);
				return {
					...event,
					index,
					labelLines: [
						`${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")} ${timezoneLabel(event.timezone, parts.offsetMinutes)}`,
						event.label,
					],
				};
			})
			.filter(Boolean)
			.sort((left, right) => left.index - right.index);
	};

	const formatPrice = (value, currency, showCurrency) => {
		const numeric = finiteNumber(value);
		if (numeric === null) return "";
		if (typeof bootstrap.currencyDisplay?.format === "function") {
			return bootstrap.currencyDisplay.format(numeric, currency, showCurrency);
		}
		const fractionDigits = ["JPY", "KRW"].includes(currency) ? 0 : 2;
		const formatted = numeric.toLocaleString("en-US", {minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits});
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

	const applySessionDividerStroke = (ctx, theme) => {
		ctx.strokeStyle = theme.muted;
		ctx.globalAlpha = 0.22;
		ctx.lineWidth = 1;
		ctx.setLineDash([]);
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

	const formatSharedTooltipDate = (value, tickers = []) => {
		const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
		if (!match) return String(value || "");
		const convertedParts = bootstrap.dateDisplay?.convertNewYorkWallTimeParts?.(value, "Asia/Hong_Kong");
		const dateParts = convertedParts || {
			year: Number(match[1]),
			monthIndex: Number(match[2]) - 1,
			day: Number(match[3]),
		};
		const month = new Date(Date.UTC(2000, dateParts.monthIndex, 1)).toLocaleString("en-US", {month: "short", timeZone: "UTC"});
		const date = typeof bootstrap.dateDisplay?.formatFullDateParts === "function"
			? bootstrap.dateDisplay.formatFullDateParts(dateParts)
			: `${dateParts.day} ${month} ${dateParts.year}`;
		const dateMarkup = `<span class="chart-tooltip-primary-date">${escapeTooltipHtml(date)}</span>`;
		if (!convertedParts) return dateMarkup;
		const selectedMarkets = new Set((tickers || []).map(marketForTicker));
		const timezones = ["Asia/Hong_Kong"];
		if (selectedMarkets.size > 1) {
			(tickers || []).forEach((ticker) => {
				const timezone = timezoneForMarket(marketForTicker(ticker));
				if (!timezones.includes(timezone)) timezones.push(timezone);
			});
		}
		const primaryDateSerial = dateSerial(convertedParts);
		const timeMarkup = timezones.map((timezone) => {
			const parts = bootstrap.dateDisplay?.convertNewYorkWallTimeParts?.(value, timezone);
			if (!parts) return "";
			const dayOffset = dateSerial(parts) - primaryDateSerial;
			const offsetLabel = dayOffset === 0 ? "" : ` (${dayOffset > 0 ? "+" : ""}${dayOffset})`;
			const time = `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`;
			return `<span class="chart-tooltip-market-time">${time} ${timezoneLabel(timezone, parts.offsetMinutes)}${offsetLabel}</span>`;
		}).join("");
		return `${dateMarkup}<span class="chart-tooltip-market-times">${timeMarkup}</span>`;
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
		if (dateElement) dateElement.innerHTML = formatSharedTooltipDate(
			rawDate,
			series.map((item) => item.ticker),
		);
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
		const requestedPeriod = new URLSearchParams(window.location.search).get("period")?.toLowerCase() || "";
		const sharedRawDates = Array.isArray(series[0]?.raw_dates) ? series[0].raw_dates : [];
		const marketSessionEvents = requestedPeriod === "1d"
			? buildMarketSessionEvents(sharedRawDates, series.map((item) => item.ticker))
			: [];
		const marketSessionEventByIndex = new Map(
			marketSessionEvents.map((event) => [event.index, event]),
		);
		const theme = readTheme();
		hideSharedHover();
		destroyPriceCharts();

		document.querySelectorAll("[data-price-subplot-canvas]").forEach((canvas) => {
			const index = Number.parseInt(canvas.dataset.seriesIndex || "", 10);
			const isBottomSubplot = index === series.length - 1;
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
			const intradayDayGroups = intraday ? buildIntradayDayGroups(rawDates) : [];
			const isShortMultiDayRange = intradayDayGroups.length >= 2 && intradayDayGroups.length <= 5;
			const singleDayLabelIndexes = intradayDayGroups.length === 1
				? new Set([0, Math.floor((rawDates.length - 1) / 2), rawDates.length - 1])
				: new Set();
			const dayLabelByIndex = new Map(isShortMultiDayRange
				? intradayDayGroups.map((group) => [
					Math.floor((group.startIndex + group.endIndex) / 2),
					formatXAxisDate(rawDates[group.startIndex]),
				])
				: []);
			const profile = profiles.find((candidate) => candidate.ticker === item.ticker) || {};
			const seriesColor = item.color || theme.accent;
			const priceCandles = Array.isArray(item.candlestick_prices) ? item.candlestick_prices : [];
			const hasOneDayCandlesticks = requestedPeriod === "1d"
				&& priceCandles.length === labels.length
				&& priceCandles.some((candle) => (
					candle?.synthetic !== true
					&& [candle?.o, candle?.h, candle?.l, candle?.c].every((value) => finiteNumber(value) !== null)
				));
			const candlePriceValues = hasOneDayCandlesticks
				? priceCandles.flatMap((candle) => [candle?.l, candle?.h]).map(finiteNumber).filter((value) => value !== null)
				: [];
			const candlePriceMin = candlePriceValues.length ? Math.min(...candlePriceValues) : null;
			const candlePriceMax = candlePriceValues.length ? Math.max(...candlePriceValues) : null;
			const candlePricePadding = candlePriceMin !== null && candlePriceMax !== null
				? Math.max((candlePriceMax - candlePriceMin) * 0.06, Math.abs(candlePriceMax) * 0.001)
				: 0;
			canvas.dataset.chartRenderMode = hasOneDayCandlesticks ? "candlestick" : "line";
			canvas.dataset.seriesColor = seriesColor;
			canvas.dataset.tradingDayCount = String(intradayDayGroups.length);
			canvas.dataset.tradingDaySeparators = String(isShortMultiDayRange ? intradayDayGroups.length - 1 : 0);
			canvas.dataset.singleDayTimeLabels = String(singleDayLabelIndexes.size);
			canvas.dataset.marketSessionEvents = String(marketSessionEvents.length);
			canvas.dataset.marketSessionLineStyle = marketSessionEvents.length ? "solid-session-divider" : "";

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
			const multiDaySessionDividerPlugin = {
				id: `priceMultiDaySessionDivider${index}`,
				beforeDatasetsDraw(chart) {
					if (!isShortMultiDayRange || !chart.chartArea || !chart.scales?.x) return;
					chart.ctx.save();
					applySessionDividerStroke(chart.ctx, theme);
					intradayDayGroups.slice(1).forEach((group) => {
						const previousX = chart.scales.x.getPixelForValue(group.startIndex - 1);
						const currentX = chart.scales.x.getPixelForValue(group.startIndex);
						const x = (previousX + currentX) / 2;
						if (!Number.isFinite(x)) return;
						chart.ctx.beginPath();
						chart.ctx.moveTo(x, chart.chartArea.top);
						chart.ctx.lineTo(x, chart.chartArea.bottom);
						chart.ctx.stroke();
					});
					chart.ctx.restore();
				},
			};
			const multiMarketSessionEventPlugin = {
				id: `priceMultiMarketSessionEvent${index}`,
				beforeDatasetsDraw(chart) {
					if (!marketSessionEvents.length || !chart.chartArea || !chart.scales?.x) return;
					chart.ctx.save();
					applySessionDividerStroke(chart.ctx, theme);
					marketSessionEvents.forEach((event) => {
						const x = chart.scales.x.getPixelForValue(event.index);
						if (!Number.isFinite(x)) return;
						chart.ctx.beginPath();
						chart.ctx.moveTo(x, chart.chartArea.top);
						chart.ctx.lineTo(x, chart.chartArea.bottom);
						chart.ctx.stroke();
					});
					chart.ctx.restore();
				},
			};
			const multiMarketSessionLabelPlugin = {
				id: `priceMultiMarketSessionLabel${index}`,
				afterDraw(chart) {
					if (!isBottomSubplot || !marketSessionEvents.length || !chart.chartArea || !chart.scales?.x) return;
					chart.ctx.save();
					chart.ctx.fillStyle = theme.muted;
					chart.ctx.font = "12px sans-serif";
					marketSessionEvents.forEach((event, eventIndex) => {
						let x = chart.scales.x.getPixelForValue(event.index);
						if (!Number.isFinite(x)) return;
						const previous = marketSessionEvents[eventIndex - 1];
						const next = marketSessionEvents[eventIndex + 1];
						const previousX = previous ? chart.scales.x.getPixelForValue(previous.index) : null;
						const nextX = next ? chart.scales.x.getPixelForValue(next.index) : null;
						const closeToPrevious = Number.isFinite(previousX) && x - previousX < 150;
						const closeToNext = Number.isFinite(nextX) && nextX - x < 150;
						if (closeToNext && !closeToPrevious) {
							chart.ctx.textAlign = "right";
							x -= 6;
						} else {
							chart.ctx.textAlign = "left";
							x += eventIndex === 0 ? 0 : 6;
						}
						event.labelLines.forEach((line, lineIndex) => {
							chart.ctx.fillText(line, x, chart.chartArea.bottom + 18 + (lineIndex * 15));
						});
					});
					chart.ctx.restore();
				},
			};
			const oneDayPriceCandlestickPlugin = {
				id: `oneDayPriceCandlestick${index}`,
				afterDatasetsDraw(chart) {
					if (!hasOneDayCandlesticks || !chart.chartArea || !chart.scales?.x || !chart.scales?.y) return;
					const validCandleCount = priceCandles.filter((candle) => (
						candle?.synthetic !== true
						&& [candle?.o, candle?.h, candle?.l, candle?.c].every((value) => finiteNumber(value) !== null)
					)).length;
					const slotWidth = chart.chartArea.width / Math.max(validCandleCount, 1);
					const candleWidth = Math.max(0.7, Math.min(slotWidth * 0.68, 5));
					const hairlineWidth = Math.max(0.5, 1 / Math.max(window.devicePixelRatio || 1, 1));
					priceCandles.forEach((candle, candleIndex) => {
						const open = finiteNumber(candle?.o);
						const high = finiteNumber(candle?.h);
						const low = finiteNumber(candle?.l);
						const close = finiteNumber(candle?.c);
						const volume = finiteNumber(candle?.v);
						if (candle?.synthetic === true || (volume !== null && volume <= 0)) return;
						if ([open, high, low, close].some((value) => value === null)) return;
						const x = chart.scales.x.getPixelForValue(candleIndex);
						const highY = chart.scales.y.getPixelForValue(high);
						const lowY = chart.scales.y.getPixelForValue(low);
						const openY = chart.scales.y.getPixelForValue(open);
						const closeY = chart.scales.y.getPixelForValue(close);
						if (![x, highY, lowY, openY, closeY].every(Number.isFinite)) return;
						const bodyTop = Math.min(openY, closeY);
						const bodyHeight = Math.max(hairlineWidth, Math.abs(closeY - openY));
						chart.ctx.save();
						chart.ctx.strokeStyle = seriesColor;
						chart.ctx.fillStyle = seriesColor;
						chart.ctx.lineWidth = hairlineWidth;
						chart.ctx.globalAlpha = 0.82;
						chart.ctx.beginPath();
						chart.ctx.moveTo(x, highY);
						chart.ctx.lineTo(x, lowY);
						chart.ctx.stroke();
						chart.ctx.globalAlpha = 0.28;
						chart.ctx.fillRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
						chart.ctx.globalAlpha = 0.82;
						chart.ctx.strokeRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
						chart.ctx.restore();
					});
				},
			};
			const firstDayReferencePricePlugin = {
				id: `firstDayReferencePrice${index}`,
				beforeDatasetsDraw(chart) {
					if (!hasOneDayCandlesticks || !["SKHY", "SKHYV"].includes(String(item.ticker || "").toUpperCase())) return;
					const referenceIndex = priceCandles.findIndex((candle) => (
						candle?.synthetic !== true
						&& [candle?.o, candle?.h, candle?.l, candle?.c].every((value) => finiteNumber(value) !== null)
						&& finiteNumber(candle.o) === finiteNumber(candle.h)
						&& finiteNumber(candle.o) === finiteNumber(candle.l)
						&& finiteNumber(candle.o) === finiteNumber(candle.c)
					));
					if (referenceIndex < 0) return;
					const firstTradeIndex = priceCandles.findIndex((candle, candleIndex) => (
						candleIndex > referenceIndex
						&& candle?.synthetic !== true
						&& [candle?.o, candle?.h, candle?.l, candle?.c].every((value) => finiteNumber(value) !== null)
					));
					const referenceDate = String(rawDates[referenceIndex] || "").slice(0, 10);
					const sessionOpenIndex = rawDates.findIndex((rawDate) => rawDate === `${referenceDate} 09:30`);
					const startIndex = sessionOpenIndex >= 0 ? sessionOpenIndex : referenceIndex;
					const referenceMinute = parseRawMinute(rawDates[startIndex]);
					const firstTradeMinute = parseRawMinute(rawDates[firstTradeIndex]);
					if (firstTradeIndex < 0 || !Number.isFinite(referenceMinute) || !Number.isFinite(firstTradeMinute) || firstTradeMinute - referenceMinute <= 5) return;
					const referencePrice = finiteNumber(priceCandles[referenceIndex].c);
					const startX = chart.scales.x.getPixelForValue(startIndex);
					const endX = chart.scales.x.getPixelForValue(firstTradeIndex);
					const y = chart.scales.y.getPixelForValue(referencePrice);
					if (![startX, endX, y].every(Number.isFinite)) return;
					chart.ctx.save();
					chart.ctx.strokeStyle = seriesColor;
					chart.ctx.globalAlpha = 0.52;
					chart.ctx.lineWidth = 1;
					chart.ctx.beginPath();
					chart.ctx.moveTo(startX, y);
					chart.ctx.lineTo(endX, y);
					chart.ctx.stroke();
					chart.ctx.restore();
					canvas.dataset.referencePrice = referencePrice.toFixed(2);
					canvas.dataset.referencePriceStartIndex = String(startIndex);
					canvas.dataset.referencePriceStartTime = rawDates[startIndex] || "";
					canvas.dataset.referencePriceEndIndex = String(firstTradeIndex);
				},
			};

			const chart = new Chart(canvas, {
				type: "line",
				data: {
					labels,
					datasets: [{
						label: item.ticker,
						data: prices,
						borderColor: seriesColor,
						borderWidth: 1.5,
						pointRadius: 0,
						pointHitRadius: 12,
						pointHoverRadius: 3,
						showLine: !hasOneDayCandlesticks,
						tension: 0,
						spanGaps: false,
						segment: {
							borderColor(context) {
								if (!intraday) return seriesColor;
								const left = parseRawMinute(rawDates[context.p0DataIndex]);
								const right = parseRawMinute(rawDates[context.p1DataIndex]);
								return Number.isFinite(left) && Number.isFinite(right) && right - left > 5
									? "transparent"
									: seriesColor;
							},
						},
					}],
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					animation: false,
					layout: {padding: {top: 8, right: RIGHT_GUTTER, bottom: isBottomSubplot && marketSessionEvents.length ? 40 : 4, left: 0}},
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
							display: isBottomSubplot,
							grid: {display: false},
							border: {display: false},
							ticks: {
								autoSkip: false,
								maxRotation: 0,
								color: theme.muted,
							callback(_value, tickIndex) {
								if (marketSessionEventByIndex.has(tickIndex)) return "";
								if (marketSessionEvents.length) return "";
								if (isShortMultiDayRange) return dayLabelByIndex.get(tickIndex) || "";
								if (singleDayLabelIndexes.has(tickIndex)) return formatSingleDayXAxisValue(rawDates[tickIndex]);
								return tickIndex === firstIndex || tickIndex === lastIndex
										? formatXAxisValue(rawDates[tickIndex], intraday)
										: "";
								},
							},
						},
						y: {
							suggestedMin: candlePriceMin === null ? undefined : candlePriceMin - candlePricePadding,
							suggestedMax: candlePriceMax === null ? undefined : candlePriceMax + candlePricePadding,
							grid: {display: false},
							border: {display: false},
							ticks: {
								color: theme.muted,
								padding: 8,
								callback: (value, tickIndex, ticks) => formatPrice(value, currency, showCurrency && tickIndex === (ticks?.length || 0) - 1),
							},
						},
					},
				},
				plugins: [fixedScaleWidthPlugin, multiDaySessionDividerPlugin, multiMarketSessionEventPlugin, multiMarketSessionLabelPlugin, firstDayReferencePricePlugin, oneDayPriceCandlestickPlugin, closingLogoPlugin, sharedHoverGuidePlugin],
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
		const requestFingerprint = `${window.location.pathname}?${pageParams.toString()}`;
		const requestSerial = ++liveRequestSerial;
		liveRequestController?.abort();
		const requestController = new AbortController();
		liveRequestController = requestController;
		try {
			const response = await fetch(`${state.endpoints.compareLive}?${params.toString()}`, {
				headers: {Accept: "application/json"},
				signal: requestController.signal,
			});
			const payload = await response.json();
			const currentParams = new URLSearchParams(window.location.search);
			const currentFingerprint = `${window.location.pathname}?${currentParams.toString()}`;
			if (requestSerial !== liveRequestSerial || requestFingerprint !== currentFingerprint) return;
			if (!response.ok || !payload.success || !Array.isArray(payload.series)) return;
			const hasLivePrice = payload.series.some((item) => (
				Array.isArray(item?.prices)
				&& item.prices.some((value) => finiteNumber(value) !== null)
			));
			if (!hasLivePrice) return;
			state.chart.series = payload.series;
			renderPriceSubplots();
		} catch (_error) {
		} finally {
			if (liveRequestController === requestController) liveRequestController = null;
		}
	};

	bootstrap.initPriceCompareWorkspace = () => {
		liveRequestSerial += 1;
		liveRequestController?.abort();
		liveRequestController = null;
		renderPriceSubplots();
		if (!refreshTimer) refreshTimer = window.setInterval(refreshLivePrices, REFRESH_MS);
	};
	bootstrap.refreshPriceCompareLive = refreshLivePrices;
	bootstrap.formatPriceSharedTooltipDate = formatSharedTooltipDate;
	bootstrap.buildPriceMarketSessionEvents = buildMarketSessionEvents;
	window.addEventListener("beforeunload", () => {
		if (refreshTimer) window.clearInterval(refreshTimer);
		destroyPriceCharts();
	}, {once: true});
	window.addEventListener("antigravity:theme-mode-change", () => window.requestAnimationFrame(renderPriceSubplots));
})();
