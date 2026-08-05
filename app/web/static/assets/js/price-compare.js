/* Code version: v0.15.7 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const state = window.ANTIGRAVITY_APP;
	if (!state) return;

	const REFRESH_MS = 45000;
	const Y_AXIS_WIDTH = 92;
	const LOGO_SIZE = 20;
	const RIGHT_GUTTER = 44;
	const ONE_DAY_CANDLE_POLICY = Object.freeze({
		version: "v1",
		bodyStyle: "solid",
		widthBasis: "shared-timeline",
		alpha: 0.82,
		minimumWidth: 0.7,
		maximumWidth: 5,
		slotRatio: 0.68,
	});
	const imageCache = new Map();
	const priceCharts = new Map();
	let refreshTimer = 0;
	let liveRequestSerial = 0;
	let liveRequestController = null;
	let sharedHoverIndex = -1;
	let teardownPriceSubplotOrdering = () => {};

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

	const timezoneLabel = (timezone, offsetMinutes, referenceDate = new Date()) => {
		if (timezone === "Asia/Hong_Kong") return "HKT";
		if (timezone === "Asia/Seoul") return "KST";
		if (timezone === "Asia/Shanghai" || timezone === "Asia/Taipei") return "CST";
		if (timezone === "Asia/Singapore") return "SGT";
		if (timezone === "Asia/Tokyo") return "JST";
		if (timezone === "Europe/London") return Number(offsetMinutes) === 60 ? "BST" : "GMT";
		if (timezone === "America/New_York") return Number(offsetMinutes) === -240 ? "EDT" : "EST";
		try {
			return new Intl.DateTimeFormat("en-US", {timeZone: timezone, timeZoneName: "short"})
				.formatToParts(referenceDate)
				.find((part) => part.type === "timeZoneName")?.value || timezone;
		} catch (_error) {
			return timezone;
		}
	};

	const formatPriceCompareHeadingDate = (
		tradingDate,
		timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
	) => {
		const match = String(tradingDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!match) return "";
		const dateParts = {
			year: Number(match[1]),
			monthIndex: Number(match[2]) - 1,
			day: Number(match[3]),
		};
		const formattedDate = typeof bootstrap.dateDisplay?.formatFullDateParts === "function"
			? bootstrap.dateDisplay.formatFullDateParts(dateParts)
			: `${dateParts.day} ${new Date(Date.UTC(2000, dateParts.monthIndex, 1)).toLocaleString("en-US", {month: "short", timeZone: "UTC"})} ${dateParts.year}`;
		const referenceDate = new Date(Date.UTC(dateParts.year, dateParts.monthIndex, dateParts.day, 12));
		const convertedParts = bootstrap.dateDisplay?.convertNewYorkWallTimeParts?.(`${tradingDate} 12:00`, timezone);
		const label = timezoneLabel(timezone, convertedParts?.offsetMinutes, referenceDate);
		return label ? `${formattedDate} ${label}` : formattedDate;
	};

	const updatePriceCompareHeadingDate = (tradingDateOverride = "") => {
		const params = new URLSearchParams(window.location.search);
		const workspaceState = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href);
		const period = workspaceState?.period || (params.get("period") || "").toLowerCase();
		if (period !== "1d") return;
		const rangeMode = workspaceState?.rangeMode || (params.get("range") || "period").toLowerCase();
		const tradingDate = rangeMode === "exact"
			? (workspaceState?.date || params.get("trading_date") || params.get("exact_trading_date") || tradingDateOverride || state.chart?.tradingDate)
			: (tradingDateOverride || state.chart?.tradingDate);
		const headingDate = formatPriceCompareHeadingDate(tradingDate);
		const displayRange = document.querySelector(".price-compare-range");
		if (displayRange instanceof HTMLElement && headingDate) displayRange.textContent = headingDate;
	};

	const dateSerial = (parts) => Math.floor(Date.UTC(parts.year, parts.monthIndex, parts.day) / 86400000);

	const buildMarketSessionEvents = (rawDates, tickers) => {
		const markets = new Set((tickers || []).map(marketForTicker));
		if (markets.size <= 1) return [];
		const eventDefinitions = [
			{market: "KR", timezone: "Asia/Seoul", hours: 9, minutes: 0},
			{market: "UK", timezone: "Europe/London", hours: 8, minutes: 0},
			{market: "HK", timezone: "Asia/Hong_Kong", hours: 16, minutes: 0},
			{market: "KR", timezone: "Asia/Seoul", hours: 15, minutes: 30},
			{market: "US", timezone: "America/New_York", hours: 4, minutes: 0},
		];
		return eventDefinitions
			.filter((event) => markets.has(event.market))
			.map((event) => {
				const index = rawDates.findIndex((rawDate) => {
					const parts = bootstrap.dateDisplay?.convertNewYorkWallTimeParts?.(rawDate, event.timezone);
					return parts?.hours === event.hours && parts?.minutes === event.minutes;
				});
				if (index < 0) return null;
				return {
					...event,
					index,
					labelLines: [formatXAxisValue(rawDates[index], true)],
				};
			})
			.filter(Boolean)
			.sort((left, right) => left.index - right.index)
			.filter((event, index, events) => (
				index === 0
				|| event.index !== events[index - 1].index
				|| event.labelLines.join("\n") !== events[index - 1].labelLines.join("\n")
			));
	};

	const layoutMarketSessionLabels = ({events, getX, measureText, left, right, gap = 10}) => {
		const labels = (events || []).map((event) => {
			const lines = Array.isArray(event.labelLines) ? event.labelLines : [];
			const width = Math.max(0, ...lines.map((line) => Number(measureText(String(line))) || 0));
			const preferredX = Number(getX(event));
			return {
				event,
				width,
				preferredX,
				x: Math.max(left + (width / 2), Math.min(preferredX, right - (width / 2))),
			};
		}).filter((label) => Number.isFinite(label.preferredX));
		for (let index = 1; index < labels.length; index += 1) {
			const previous = labels[index - 1];
			const current = labels[index];
			current.x = Math.max(current.x, previous.x + (previous.width / 2) + gap + (current.width / 2));
		}
		for (let index = labels.length - 1; index >= 0; index -= 1) {
			const current = labels[index];
			const maximumX = index === labels.length - 1
				? right - (current.width / 2)
				: labels[index + 1].x - (labels[index + 1].width / 2) - gap - (current.width / 2);
			current.x = Math.min(current.x, maximumX);
		}
		for (let index = 0; index < labels.length; index += 1) {
			const current = labels[index];
			const minimumX = index === 0
				? left + (current.width / 2)
				: labels[index - 1].x + (labels[index - 1].width / 2) + gap + (current.width / 2);
			current.x = Math.max(current.x, minimumX);
		}
		return labels;
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

	const updateSharedHover = (dataIndex, sourceChart, event, {series, profiles, showCurrency}) => {
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
			listElement.innerHTML = series.map((item) => {
				const profile = profiles.find((candidate) => candidate.ticker === item.ticker) || {};
				const price = Array.isArray(item.prices) ? item.prices[dataIndex] : null;
				const value = finiteNumber(price);
				return `
					<div class="chart-tooltip-row">
						<span class="chart-tooltip-dot" style="background:${escapeTooltipHtml(item.color || "currentColor")}"></span>
						${profile.logo_url ? `<img class="chart-tooltip-logo" src="${escapeTooltipHtml(profile.logo_url)}" alt="">` : "<span></span>"}
						<span class="chart-tooltip-label">${escapeTooltipHtml(item.ticker)}</span>
						<span class="chart-tooltip-value">${value === null ? "—" : escapeTooltipHtml(formatPrice(value, currencyForTicker(item.ticker), showCurrency))}</span>
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

	const tickerOrderIdentity = (value) => {
		const ticker = String(value || "").trim().toUpperCase();
		return ["SKHY", "SKHYV"].includes(ticker) ? "SKHY" : ticker;
	};

	const getPriceSubplotSections = () => Array.from(
		document.querySelectorAll("#price_subplot_region > [data-price-subplot]"),
	).filter((section) => section instanceof HTMLElement);

	const reorderSeriesInPlace = (tickerOrder) => {
		const series = Array.isArray(state.chart?.series) ? state.chart.series : [];
		const remaining = [...series];
		const ordered = [];
		tickerOrder.forEach((ticker) => {
			const identity = tickerOrderIdentity(ticker);
			const matchIndex = remaining.findIndex((item) => tickerOrderIdentity(item?.ticker) === identity);
			if (matchIndex < 0) return;
			ordered.push(remaining.splice(matchIndex, 1)[0]);
		});
		ordered.push(...remaining);
		series.splice(0, series.length, ...ordered);
	};

	const syncPriceSubplotOrderMetadata = () => {
		const sections = getPriceSubplotSections();
		sections.forEach((section, index) => {
			const ticker = String(section.dataset.ticker || "").trim().toUpperCase();
			const handle = section.querySelector("[data-price-subplot-order-handle]");
			const canvas = section.querySelector("[data-price-subplot-canvas]");
			if (handle instanceof HTMLButtonElement) {
				handle.setAttribute(
					"aria-label",
					`Reorder ${ticker} subplot; position ${index + 1} of ${sections.length}`,
				);
			}
			if (!(canvas instanceof HTMLCanvasElement)) return;
			canvas.dataset.seriesIndex = String(index);
			const chart = window.Chart?.getChart?.(canvas);
			if (!chart) return;
			const isBottom = index === sections.length - 1;
			if (chart.options.scales?.x) chart.options.scales.x.display = isBottom;
			if (chart.options.layout?.padding && typeof chart.options.layout.padding === "object") {
				chart.options.layout.padding.bottom = isBottom && Number(canvas.dataset.marketSessionEvents || 0) > 0
					? 22
					: 4;
			}
			chart.update("none");
		});
	};

	const animatePriceSubplotOrder = (sections, previousTopBySection) => {
		sections.forEach((section) => {
			const previousTop = previousTopBySection.get(section);
			const nextTop = section.getBoundingClientRect().top;
			const deltaY = Number(previousTop) - nextTop;
			if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
			window.AntigravityMotion?.animate?.(
				section,
				[
					{
						transform: `translate3d(0, ${deltaY}px, 0) scale(0.985)`,
						filter: "drop-shadow(0 18px 30px rgba(15, 23, 42, 0.14))",
					},
					{
						transform: "translate3d(0, 0, 0) scale(1)",
						filter: "drop-shadow(0 0 0 rgba(15, 23, 42, 0))",
					},
				],
				{
					duration: window.AntigravityMotion?.durations?.emphasized ?? 420,
					easing: window.AntigravityMotion?.easingTokens?.emphasized,
				},
			);
		});
	};

	const commitPriceSubplotOrder = (sourceSection, destinationIndex, {focusHandle = false} = {}) => {
		const grid = document.getElementById("price_subplot_region");
		const sections = getPriceSubplotSections();
		const sourceIndex = sections.indexOf(sourceSection);
		const boundedDestination = Math.max(0, Math.min(Number(destinationIndex), sections.length - 1));
		if (!(grid instanceof HTMLElement) || sourceIndex < 0 || sourceIndex === boundedDestination) return false;
		const previousTopBySection = new Map(
			sections.map((section) => [section, section.getBoundingClientRect().top]),
		);
		const remaining = sections.filter((section) => section !== sourceSection);
		grid.insertBefore(sourceSection, remaining[boundedDestination] || null);
		const reorderedSections = getPriceSubplotSections();
		const orderedTickers = reorderedSections.map((section) => section.dataset.ticker || "");
		reorderSeriesInPlace(orderedTickers);
		bootstrap.reorderTickerFieldsByTicker?.(orderedTickers);
		liveRequestSerial += 1;
		liveRequestController?.abort();
		liveRequestController = null;
		hideSharedHover();
		syncPriceSubplotOrderMetadata();
		animatePriceSubplotOrder(reorderedSections, previousTopBySection);
		const status = document.querySelector("[data-price-subplot-order-status]");
		if (status instanceof HTMLElement) {
			status.textContent = `${sourceSection.dataset.ticker || "Ticker"} moved to position ${boundedDestination + 1}.`;
		}
		if (focusHandle) {
			sourceSection.querySelector("[data-price-subplot-order-handle]")?.focus({preventScroll: true});
		}
		return true;
	};

	const initializePriceSubplotOrdering = () => {
		const sections = getPriceSubplotSections();
		if (state.currentView !== "prices" || sections.length < 2) return () => {};
		let activeDrag = null;
		let insertionSection = null;
		const disposers = [];

		const clearInsertionMarker = () => {
			insertionSection?.classList.remove("is-order-insert-before", "is-order-insert-after");
			insertionSection = null;
		};

		const markInsertion = (sourceSection, destinationIndex) => {
			clearInsertionMarker();
			const currentSections = getPriceSubplotSections();
			const sourceIndex = currentSections.indexOf(sourceSection);
			if (sourceIndex < 0 || destinationIndex === sourceIndex) return;
			const remaining = currentSections.filter((section) => section !== sourceSection);
			const nextSection = remaining[destinationIndex];
			const previousSection = remaining[destinationIndex - 1];
			insertionSection = nextSection || previousSection || null;
			insertionSection?.classList.add(nextSection ? "is-order-insert-before" : "is-order-insert-after");
		};

		const destinationIndexForY = (sourceSection, clientY) => {
			const remaining = getPriceSubplotSections().filter((section) => section !== sourceSection);
			const index = remaining.findIndex((section) => {
				const rect = section.getBoundingClientRect();
				return clientY < rect.top + (rect.height / 2);
			});
			return index < 0 ? remaining.length : index;
		};

		const updateDrag = (event) => {
			if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
			const {sourceSection, startY, sourceHeight} = activeDrag;
			const rawDelta = event.clientY - startY;
			const progress = Math.min(Math.abs(rawDelta) / Math.max(sourceHeight, 1), 2);
			const acceleratedY = Math.sign(rawDelta) * Math.abs(rawDelta) * (1 + (0.14 * progress * progress));
			const depthScale = 1 + (0.018 * (1 - Math.exp(-2.8 * progress)));
			sourceSection.style.setProperty("--price-subplot-order-y", `${acceleratedY.toFixed(2)}px`);
			sourceSection.style.setProperty("--price-subplot-order-z", depthScale.toFixed(4));
			activeDrag.destinationIndex = destinationIndexForY(sourceSection, event.clientY);
			markInsertion(sourceSection, activeDrag.destinationIndex);
		};

		const finishDrag = (event, {cancelled = false} = {}) => {
			if (!activeDrag || (event?.pointerId !== undefined && event.pointerId !== activeDrag.pointerId)) return;
			const drag = activeDrag;
			activeDrag = null;
			window.removeEventListener("pointermove", updateDrag);
			window.removeEventListener("pointerup", finishDrag);
			window.removeEventListener("pointercancel", cancelDrag);
			drag.sourceSection.classList.remove("is-order-dragging");
			drag.sourceSection.style.removeProperty("--price-subplot-order-y");
			drag.sourceSection.style.removeProperty("--price-subplot-order-z");
			drag.handle.classList.remove("is-resizing");
			drag.handle.setAttribute("aria-grabbed", "false");
			document.body.classList.remove("is-price-subplot-reordering");
			clearInsertionMarker();
			if (typeof drag.handle.releasePointerCapture === "function") {
				try {
					drag.handle.releasePointerCapture(drag.pointerId);
				} catch (_error) {
				}
			}
			if (!cancelled) commitPriceSubplotOrder(drag.sourceSection, drag.destinationIndex);
		};

		function cancelDrag(event) {
			finishDrag(event, {cancelled: true});
		}

		sections.forEach((section) => {
			const handle = section.querySelector("[data-price-subplot-order-handle]");
			if (!(handle instanceof HTMLButtonElement)) return;
			handle.dataset.bound = "1";
			handle.setAttribute("aria-grabbed", "false");
			const revealFromPointer = (event) => {
				if (activeDrag || event.pointerType === "touch") return;
				const rect = section.getBoundingClientRect();
				section.classList.toggle("is-order-handle-visible", event.clientX >= rect.left + (rect.width / 2));
			};
			const hideHandle = () => {
				if (!activeDrag && !section.contains(document.activeElement)) {
					section.classList.remove("is-order-handle-visible");
				}
			};
			const onPointerDown = (event) => {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				const sourceIndex = getPriceSubplotSections().indexOf(section);
				if (sourceIndex < 0) return;
				activeDrag = {
					sourceSection: section,
					handle,
					pointerId: event.pointerId,
					startY: event.clientY,
					sourceHeight: section.getBoundingClientRect().height,
					destinationIndex: sourceIndex,
				};
				handle.classList.add("is-resizing");
				handle.setAttribute("aria-grabbed", "true");
				section.classList.add("is-order-dragging", "is-order-handle-visible");
				document.body.classList.add("is-price-subplot-reordering");
				hideSharedHover();
				if (typeof handle.setPointerCapture === "function") {
					try {
						handle.setPointerCapture(event.pointerId);
					} catch (_error) {
					}
				}
				window.addEventListener("pointermove", updateDrag);
				window.addEventListener("pointerup", finishDrag);
				window.addEventListener("pointercancel", cancelDrag);
			};
			const onKeyDown = (event) => {
				const currentSections = getPriceSubplotSections();
				const currentIndex = currentSections.indexOf(section);
				let destinationIndex = null;
				if (event.key === "ArrowUp") destinationIndex = currentIndex - 1;
				if (event.key === "ArrowDown") destinationIndex = currentIndex + 1;
				if (event.key === "Home") destinationIndex = 0;
				if (event.key === "End") destinationIndex = currentSections.length - 1;
				if (!Number.isFinite(destinationIndex)) return;
				event.preventDefault();
				commitPriceSubplotOrder(section, destinationIndex, {focusHandle: true});
			};
			section.addEventListener("pointermove", revealFromPointer);
			section.addEventListener("pointerleave", hideHandle);
			handle.addEventListener("pointerdown", onPointerDown);
			handle.addEventListener("keydown", onKeyDown);
			disposers.push(() => {
				section.removeEventListener("pointermove", revealFromPointer);
				section.removeEventListener("pointerleave", hideHandle);
				handle.removeEventListener("pointerdown", onPointerDown);
				handle.removeEventListener("keydown", onKeyDown);
				delete handle.dataset.bound;
			});
		});
		syncPriceSubplotOrderMetadata();
		return () => {
			if (activeDrag) cancelDrag({pointerId: activeDrag.pointerId});
			disposers.forEach((dispose) => dispose());
			clearInsertionMarker();
		};
	};

	const renderPriceSubplots = () => {
		if (state.currentView !== "prices" || !window.Chart) return;
		const series = Array.isArray(state.chart?.series) ? state.chart.series : [];
		const profiles = Array.isArray(state.chart?.profiles) ? state.chart.profiles : [];
		const currencies = series.map((item) => currencyForTicker(item.ticker));
		const showCurrency = new Set(currencies).size > 1;
		const requestedPeriod = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href)?.period
			|| new URLSearchParams(window.location.search).get("period")?.toLowerCase()
			|| "";
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
			const isBottomSubplot = () => canvas.closest("[data-price-subplot]") === document.querySelector("#price_subplot_region > [data-price-subplot]:last-child");
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
			canvas.dataset.candlePolicy = hasOneDayCandlesticks ? ONE_DAY_CANDLE_POLICY.version : "";
			canvas.dataset.candleBodyStyle = hasOneDayCandlesticks ? ONE_DAY_CANDLE_POLICY.bodyStyle : "";
			canvas.dataset.candleWidthBasis = hasOneDayCandlesticks ? ONE_DAY_CANDLE_POLICY.widthBasis : "";
			canvas.dataset.candleAlpha = hasOneDayCandlesticks ? ONE_DAY_CANDLE_POLICY.alpha.toFixed(2) : "";
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
					if (!isBottomSubplot() || !marketSessionEvents.length || !chart.chartArea || !chart.scales?.x) return;
					chart.ctx.save();
					chart.ctx.fillStyle = theme.muted;
					chart.ctx.font = "12px sans-serif";
					chart.ctx.textAlign = "center";
					const labels = layoutMarketSessionLabels({
						events: marketSessionEvents,
						getX: (event) => chart.scales.x.getPixelForValue(event.index),
						measureText: (line) => chart.ctx.measureText(line).width,
						left: chart.chartArea.left,
						right: chart.chartArea.right,
					});
					labels.forEach(({event, x}) => {
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
					const slotWidth = chart.chartArea.width / Math.max(labels.length, 1);
					const candleWidth = Math.max(
						ONE_DAY_CANDLE_POLICY.minimumWidth,
						Math.min(
							slotWidth * ONE_DAY_CANDLE_POLICY.slotRatio,
							ONE_DAY_CANDLE_POLICY.maximumWidth,
						),
					);
					canvas.dataset.candleWidth = candleWidth.toFixed(3);
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
						chart.ctx.globalAlpha = ONE_DAY_CANDLE_POLICY.alpha;
						chart.ctx.beginPath();
						chart.ctx.moveTo(x, highY);
						chart.ctx.lineTo(x, lowY);
						chart.ctx.stroke();
						chart.ctx.globalAlpha = ONE_DAY_CANDLE_POLICY.alpha;
						chart.ctx.fillRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
						chart.ctx.globalAlpha = ONE_DAY_CANDLE_POLICY.alpha;
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
					layout: {padding: {top: 8, right: RIGHT_GUTTER, bottom: isBottomSubplot() && marketSessionEvents.length ? 22 : 4, left: 0}},
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
							display: isBottomSubplot(),
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
		const workspaceState = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href);
		const period = workspaceState?.period || (pageParams.get("period") || "").toLowerCase();
		const rangeMode = workspaceState?.rangeMode || (pageParams.get("range") || "period").toLowerCase();
		if (!state.endpoints?.compareLive || !["1d", "3d", "1w"].includes(period)) return;
		if (rangeMode === "exact" && period !== "1d") return;
		const selectedTradingDate = workspaceState?.date || pageParams.get("trading_date") || pageParams.get("exact_trading_date") || "";
		if (rangeMode === "exact" && selectedTradingDate !== formatLocalIsoDate()) return;
		const tickers = (state.chart?.series || [])
			.map((item) => String(item?.ticker || "").trim())
			.filter(Boolean);
		if (tickers.length < 2) return;
		const params = new URLSearchParams();
		tickers.forEach((ticker) => params.append("ticker", ticker));
		params.set("period", period);
		params.set("live_date", formatLocalIsoDate());
		if (rangeMode === "exact") params.set("axis_date", state.chart?.tradingDate || selectedTradingDate || "");
		if (pageParams.get("extended-hours") === "1" || pageParams.get("extended_hours") === "1") params.set("extended_hours", "1");
		if (pageParams.get("overnight") === "1") params.set("overnight", "1");
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
			if (rangeMode !== "exact" && payload.liveDate) {
				state.chart.tradingDate = payload.liveDate;
			}
			updatePriceCompareHeadingDate(rangeMode === "exact" ? selectedTradingDate : payload.liveDate);
			renderPriceSubplots();
		} catch (_error) {
		} finally {
			if (liveRequestController === requestController) liveRequestController = null;
		}
	};

	bootstrap.initPriceCompareWorkspace = () => {
		teardownPriceSubplotOrdering();
		teardownPriceSubplotOrdering = () => {};
		liveRequestSerial += 1;
		liveRequestController?.abort();
		liveRequestController = null;
		renderPriceSubplots();
		teardownPriceSubplotOrdering = initializePriceSubplotOrdering();
		updatePriceCompareHeadingDate();
		const initialParams = new URLSearchParams(window.location.search);
		const initialPeriod = (initialParams.get("period") || "").toLowerCase();
		if (initialPeriod === "1d") void refreshLivePrices();
		if (!refreshTimer) refreshTimer = window.setInterval(refreshLivePrices, REFRESH_MS);
	};
	bootstrap.refreshPriceCompareLive = refreshLivePrices;
	bootstrap.formatPriceSharedTooltipDate = formatSharedTooltipDate;
	bootstrap.formatPriceCompareHeadingDate = formatPriceCompareHeadingDate;
	bootstrap.layoutPriceMarketSessionLabels = layoutMarketSessionLabels;
	bootstrap.buildPriceMarketSessionEvents = buildMarketSessionEvents;
	window.addEventListener("beforeunload", () => {
		if (refreshTimer) window.clearInterval(refreshTimer);
		teardownPriceSubplotOrdering();
		destroyPriceCharts();
	}, {once: true});
	window.addEventListener("antigravity:theme-mode-change", () => window.requestAnimationFrame(renderPriceSubplots));
})();
