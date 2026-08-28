/* Code version: v0.24.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const state = window.ANTIGRAVITY_APP;
	const chartAxis = window.ANTIGRAVITY_CHART_AXIS || {};
	if (!state) return;
	const isPriceComparison = () => (
		state.currentView === "prices"
		&& String(state.comparisonMetric || "").trim().toLowerCase() !== "market-cap"
	);

	const REFRESH_MS = 45000;
	const Y_AXIS_MIN_WIDTH = 36;
	const LOGO_SIZE = 20;
	const RIGHT_GUTTER = 44;
	const CHIP_PANEL_MIN_WIDTH = 116;
	const CHIP_PANEL_MAX_WIDTH = 190;
	const CHIP_PANEL_GAP = 10;
	const CHIP_PANEL_RIGHT_PADDING = 8;
	const CHIP_PANEL_TOP_PADDING = 8;
	const CHIP_HOVER_PRICE_MARKER_RADIUS = 3;
	const CHIP_DISTRIBUTION_BIN_COUNT = 100;
	const CHIP_DISTRIBUTION_CACHE_LIMIT = 64;
	const CHIP_SNAPSHOT_CACHE_LIMIT = 48;
	const CHIPS_PAYLOAD_CACHE_LIMIT = 64;
	const PRICE_LEVEL_MINIMUM_HISTORICAL_RANGE_COVERAGE = 0.35;
	const CHIP_REVEAL_MOTION_KEY = "price-compare-chip-reveal";
	const CHIP_REVEAL_MOTION_NAME = "shared-bouncy-spring";
	const CHIP_REVEAL_FALLBACK_DURATION = 620;
	const ONE_DAY_CANDLE_POLICY = Object.freeze({
		version: "v1",
		bodyStyle: "solid",
		widthBasis: "shared-timeline",
		alpha: 0.82,
		minimumWidth: 0.7,
		maximumWidth: 5,
		slotRatio: 0.68,
	});
	const ONE_DAY_US_SESSION_DIVIDER_MINUTES = Object.freeze([
		(9 * 60) + 30,
		16 * 60,
	]);
	const LONG_RANGE_TOOLTIP_PERIODS = new Set(["6mo", "1y", "2y", "3y", "5y", "10y", "max"]);
	const imageCache = new Map();
	const priceCharts = new Map();
	const chipsPayloadCache = new Map();
	const chipDistributionCache = new Map();
	let refreshTimer = 0;
	let liveRequestSerial = 0;
	let liveRequestController = null;
	let chipsRequestSerial = 0;
	let chipsRequestController = null;
	let chipsRequestKeyInFlight = "";
	let sharedHoverIndex = -1;
	let chipHoverState = null;
	let activeChipSnapshotIndex = -1;
	let activeChipSnapshotDate = "";
	let pendingChipSnapshot = null;
	let chipSnapshotFrame = 0;
	let cancelChipRevealMotion = null;
	let chipRevealLogoOrigins = new Map();
	const chipRevealMotion = {
		active: false,
		generation: 0,
		profileProgress: 1,
		logoProgress: 1,
		rawProgress: 1,
	};
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

	const buildOneDayUsSessionDividerIndexes = (rawDates, includeOvernight = false) => {
		if (!Array.isArray(rawDates) || !rawDates.length) return [];
		const sessionDate = String(rawDates.find((value) => {
			const minute = parseRawMinute(value);
			const minuteOfDay = Number.isFinite(minute) ? minute % 1440 : null;
			return Number.isFinite(minuteOfDay)
				&& minuteOfDay >= (4 * 60)
				&& minuteOfDay < (20 * 60);
		}) || "").slice(0, 10);
		if (!sessionDate) return [];
		const dividerMinutes = includeOvernight
			? [(4 * 60), ...ONE_DAY_US_SESSION_DIVIDER_MINUTES]
			: [...ONE_DAY_US_SESSION_DIVIDER_MINUTES];
		return dividerMinutes
			.map((boundaryMinute) => {
				const boundaryIndex = rawDates.findIndex((value) => {
					const minute = parseRawMinute(value);
					return String(value).slice(0, 10) === sessionDate
						&& Number.isFinite(minute)
						&& (minute % 1440) >= boundaryMinute;
				});
				if (boundaryIndex <= 0 || boundaryIndex >= rawDates.length) return null;
				const previousIndex = boundaryIndex - 1;
				const previousMinute = parseRawMinute(rawDates[previousIndex]);
				const currentMinute = parseRawMinute(rawDates[boundaryIndex]);
				if (!Number.isFinite(previousMinute) || !Number.isFinite(currentMinute)) return null;
				return {boundaryMinute, leftIndex: previousIndex, rightIndex: boundaryIndex};
			})
			.filter(Boolean);
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

	const formatPriceAxis = (value, currency, showCurrency) => {
		const numeric = finiteNumber(value);
		if (numeric === null) return "";
		if (typeof chartAxis.formatStockPriceAxisValue === "function") {
			return chartAxis.formatStockPriceAxisValue(numeric, {currency, showCurrency});
		}
		const fractionDigits = Math.abs(numeric) >= 100 ? 0 : 2;
		const formatted = numeric.toLocaleString("en-US", {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		});
		return showCurrency ? `${currency} ${formatted}` : formatted;
	};

	const getDynamicPriceYAxisWidth = (scale) => {
		const widestLabelWidth = Number(scale?._labelSizes?.widest?.width) || 0;
		const tickPadding = Number(scale?.options?.ticks?.padding) || 0;
		const borderWidth = scale?.options?.border?.display === false ? 0 : 1;
		return Math.max(
			Y_AXIS_MIN_WIDTH,
			Math.ceil(widestLabelWidth + tickPadding + borderWidth + 2),
		);
	};

	const readTheme = () => {
		const computed = getComputedStyle(document.body);
		return {
			text: computed.getPropertyValue("--theme-text").trim(),
			muted: computed.getPropertyValue("--theme-muted").trim(),
			accent: computed.getPropertyValue("--theme-accent-primary").trim(),
			secondary: computed.getPropertyValue("--theme-accent-secondary").trim(),
			positive: computed.getPropertyValue("--theme-accent-positive").trim(),
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
			canvas.onpointermove = null;
			window.Chart?.getChart?.(canvas)?.destroy();
		});
		priceCharts.clear();
		sharedHoverIndex = -1;
		chipHoverState = null;
	};

	const getChipsInput = () => document.querySelector("#show_chips");

	const isChipsEnabled = () => {
		if (!isPriceComparison()) return false;
		const input = getChipsInput();
		return input instanceof HTMLInputElement ? input.checked : Boolean(state.comparisonChips);
	};

	const constrainJellyTravel = (progress) => {
		const numeric = Number(progress);
		if (!Number.isFinite(numeric)) return 1;
		if (numeric <= 1) return Math.max(0, numeric);
		return Math.max(0.94, 1 - ((numeric - 1) * 0.16));
	};

	const syncChipRevealCanvasState = () => {
		priceCharts.forEach((chart) => {
			const canvas = chart?.canvas;
			if (!(canvas instanceof HTMLCanvasElement)) return;
			canvas.dataset.chipRevealState = chipRevealMotion.active ? "running" : "settled";
			canvas.dataset.chipRevealProgress = chipRevealMotion.profileProgress.toFixed(4);
			canvas.dataset.chipLogoProgress = chipRevealMotion.logoProgress.toFixed(4);
		});
	};

	const redrawPriceCharts = () => {
		syncChipRevealCanvasState();
		priceCharts.forEach((chart) => {
			if (!chart?.canvas?.isConnected || window.Chart?.getChart?.(chart.canvas) !== chart) return;
			chart.draw();
		});
	};

	const settleChipRevealMotion = () => {
		chipRevealMotion.generation += 1;
		cancelChipRevealMotion?.();
		cancelChipRevealMotion = null;
		chipRevealMotion.active = false;
		chipRevealMotion.profileProgress = 1;
		chipRevealMotion.logoProgress = 1;
		chipRevealMotion.rawProgress = 1;
		chipRevealLogoOrigins = new Map();
	};

	const prepareChipRevealMotion = () => {
		settleChipRevealMotion();
		if (window.AntigravityMotion?.isReducedMotion?.()) return false;
		const origins = new Map();
		priceCharts.forEach((chart, index) => {
			const position = chart?.$closingLogoPosition;
			if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
			origins.set(index, {
				xRatio: position.x / Math.max(1, Number(chart.width) || 1),
				yRatio: position.y / Math.max(1, Number(chart.height) || 1),
			});
		});
		chipRevealLogoOrigins = origins;
		chipRevealMotion.active = true;
		chipRevealMotion.profileProgress = 0;
		chipRevealMotion.logoProgress = 0;
		chipRevealMotion.rawProgress = 0;
		return true;
	};

	const startChipRevealMotion = () => {
		if (!chipRevealMotion.active || !isChipsEnabled()) return;
		const motion = window.AntigravityMotion;
		const scheduler = motion?.scheduler;
		if (!scheduler?.animate || !motion?.easing?.spring) {
			settleChipRevealMotion();
			redrawPriceCharts();
			return;
		}
		const generation = chipRevealMotion.generation;
		const springPreset = motion.springPresets?.bouncy;
		cancelChipRevealMotion = scheduler.animate({
			key: CHIP_REVEAL_MOTION_KEY,
			duration: springPreset?.duration ?? CHIP_REVEAL_FALLBACK_DURATION,
			ease: (progress) => motion.easing.spring(progress, springPreset),
			update(easedProgress, rawProgress) {
				if (generation !== chipRevealMotion.generation) return;
				chipRevealMotion.profileProgress = Math.max(0, Number(easedProgress) || 0);
				chipRevealMotion.logoProgress = constrainJellyTravel(easedProgress);
				chipRevealMotion.rawProgress = Math.max(0, Math.min(1, Number(rawProgress) || 0));
				redrawPriceCharts();
			},
			complete() {
				if (generation !== chipRevealMotion.generation) return;
				chipRevealMotion.active = false;
				chipRevealMotion.profileProgress = 1;
				chipRevealMotion.logoProgress = 1;
				chipRevealMotion.rawProgress = 1;
				chipRevealLogoOrigins = new Map();
				cancelChipRevealMotion = null;
				redrawPriceCharts();
			},
		});
	};

	const syncChipsPresentation = (enabled) => {
		const priceRegion = document.querySelector("[data-price-chart-region]");
		const chipsRegion = document.querySelector("[data-chips-chart-region]");
		const heading = document.querySelector("[data-price-compare-heading]");
		if (priceRegion instanceof HTMLElement) priceRegion.hidden = false;
		if (chipsRegion instanceof HTMLElement) chipsRegion.hidden = !enabled;
		if (heading instanceof HTMLElement) {
			heading.textContent = heading.dataset.priceHeading || "Price history";
		}
	};

	const formatChipVolumeFull = (value) => {
		const numeric = finiteNumber(value);
		if (numeric === null) return "—";
		return new Intl.NumberFormat("en-US", {maximumFractionDigits: 0}).format(numeric);
	};

	const chipBinIsLoss = (bin, currentPrice) => {
		const price = finiteNumber(bin?.price);
		const current = finiteNumber(currentPrice);
		return price !== null && current !== null && price >= current;
	};

	const formatChipPosition = (bin, currentPrice) => {
		if (finiteNumber(bin?.price) === null || finiteNumber(currentPrice) === null) return "—";
		return chipBinIsLoss(bin, currentPrice) ? "Loss" : "Profit";
	};

	const setChipsStatus = (message = "", stateName = "", {tickers = []} = {}) => {
		const isLoading = stateName === "loading";
		const loadingTickers = new Set((Array.isArray(tickers) ? tickers : [])
			.map((ticker) => String(ticker || "").trim().toUpperCase())
			.filter(Boolean));
		const hasScopedLoading = isLoading && loadingTickers.size > 0;
		document.querySelectorAll("[data-price-subplot]").forEach((section) => {
			const ticker = String(section.dataset.ticker || "").trim().toUpperCase();
			const sectionIsLoading = isLoading && (!hasScopedLoading || loadingTickers.has(ticker));
			section.setAttribute("aria-busy", sectionIsLoading ? "true" : "false");
			const spinner = section.querySelector("[data-chip-loading-spinner]");
			if (spinner instanceof HTMLElement) spinner.hidden = !sectionIsLoading;
		});
		const status = document.querySelector("[data-chips-chart-status]");
		if (!(status instanceof HTMLElement)) return;
		status.textContent = message;
		status.hidden = !message;
		if (stateName) status.dataset.state = stateName;
		else delete status.dataset.state;
	};

	const chipVisibleDateBounds = () => {
		const dates = (state.chart?.series || [])
			.flatMap((item) => Array.isArray(item?.ohlcv) ? item.ohlcv : [])
			.map((row) => String(row?.t || "").slice(0, 10))
			.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
			.sort();
		return dates.length ? {from: dates[0], to: dates[dates.length - 1]} : {from: "", to: ""};
	};

	const chipsRequestKey = () => {
		const tickers = (state.chart?.series || [])
			.map((item) => String(item?.ticker || "").trim().toUpperCase())
			.filter(Boolean)
			.join("|");
		const period = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href)?.period
			|| new URLSearchParams(window.location.search).get("period")?.toLowerCase()
			|| "";
		const {from, to} = chipVisibleDateBounds();
		return [tickers, period, from, to].join("|");
	};

	const parseChipsRequestKey = (requestKey) => {
		const parts = String(requestKey || "").split("|");
		if (parts.length < 4) return null;
		return {
			tickers: parts.slice(0, -3).map((ticker) => String(ticker || "").trim().toUpperCase()).filter(Boolean),
			period: parts.at(-3) || "",
			from: parts.at(-2) || "",
			to: parts.at(-1) || "",
		};
	};

	const cacheChipsPayload = (requestKey, payload) => {
		if (!payload || typeof payload !== "object") return null;
		chipsPayloadCache.set(requestKey, payload);
		while (chipsPayloadCache.size > CHIPS_PAYLOAD_CACHE_LIMIT) {
			chipsPayloadCache.delete(chipsPayloadCache.keys().next().value);
		}
		return payload;
	};

	const chipPayloadIncludesTickers = (payload, requestedTickers) => {
		const seriesTickers = new Set((Array.isArray(payload?.series) ? payload.series : [])
			.map((item) => String(item?.ticker || "").trim().toUpperCase())
			.filter(Boolean));
		const errorTickers = new Set(Object.keys(payload?.errors && typeof payload.errors === "object" ? payload.errors : {})
			.map((ticker) => String(ticker || "").trim().toUpperCase())
			.filter(Boolean));
		return requestedTickers.every((ticker) => seriesTickers.has(ticker) || errorTickers.has(ticker));
	};

	const subsetCachedChipsPayload = (payload, requestedTickers) => {
		const requestedSet = new Set(requestedTickers);
		const series = Array.isArray(payload?.series) ? payload.series : [];
		const seriesByTicker = new Map(series.map((item) => [
			String(item?.ticker || "").trim().toUpperCase(),
			item,
		]));
		const cachedErrors = payload?.errors && typeof payload.errors === "object" ? payload.errors : {};
		const hasAllRequestedTickers = requestedTickers.every((ticker) => (
			seriesByTicker.has(ticker) || Object.prototype.hasOwnProperty.call(cachedErrors, ticker)
		));
		if (!hasAllRequestedTickers) return null;
		return {
			...payload,
			series: series.filter((item) => requestedSet.has(String(item?.ticker || "").trim().toUpperCase())),
			errors: Object.fromEntries(Object.entries(cachedErrors).filter(([ticker]) => (
			requestedSet.has(String(ticker || "").trim().toUpperCase())
		))),
		};
	};

	const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

	const sliceCachedChipsPayloadToRange = (payload, requestedTickers, from, to) => {
		if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
		const subset = subsetCachedChipsPayload(payload, requestedTickers);
		if (!subset) return null;
		const errors = subset.errors && typeof subset.errors === "object" ? subset.errors : {};
		const series = subset.series.map((item) => {
			if (!Array.isArray(item?.ohlcv)) return null;
			const ohlcv = item.ohlcv.filter((row) => {
				const date = String(row?.t || "").slice(0, 10);
				return isIsoDate(date) && date >= from && date <= to;
			});
			return {...item, ohlcv};
		});
		const seriesByTicker = new Map(series.filter(Boolean).map((item) => [
			String(item?.ticker || "").trim().toUpperCase(),
			item,
		]));
		const canReuseRange = requestedTickers.every((ticker) => {
			if (Object.prototype.hasOwnProperty.call(errors, ticker)) return true;
			const item = seriesByTicker.get(ticker);
			return item && hasUsableOhlcv(item);
		});
		if (!canReuseRange) return null;
		return {...subset, series: series.filter(Boolean)};
	};

	const getCachedChipsPayload = (requestKey) => {
		const requested = parseChipsRequestKey(requestKey);
		if (!requested?.tickers.length) return null;
		const direct = chipsPayloadCache.get(requestKey);
		if (direct && chipPayloadIncludesTickers(direct, requested.tickers)) return direct;
		for (const [cachedKey, payload] of chipsPayloadCache.entries()) {
			if (cachedKey === requestKey) continue;
			const cached = parseChipsRequestKey(cachedKey);
			if (!cached) continue;
			if (cached.tickers.length < requested.tickers.length) continue;
			const sameDateRange = cached.from === requested.from && cached.to === requested.to;
			const coversRequestedRange = isIsoDate(cached.from)
				&& isIsoDate(cached.to)
				&& isIsoDate(requested.from)
				&& isIsoDate(requested.to)
				&& cached.from <= requested.from
				&& cached.to >= requested.to;
			const sameScope = cached.period === requested.period && sameDateRange;
			if (!sameScope && !coversRequestedRange) continue;
			const reusable = sameDateRange
				? subsetCachedChipsPayload(payload, requested.tickers)
				: sliceCachedChipsPayloadToRange(payload, requested.tickers, requested.from, requested.to);
			if (reusable) return cacheChipsPayload(requestKey, reusable);
		}
		return null;
	};

	const getCachedChipEntriesForRequest = (requestKey, requestedTickers) => {
		const requested = parseChipsRequestKey(requestKey);
		if (!requested?.tickers.length) return new Map();
		const requestedSet = new Set(requestedTickers);
		const reusable = new Map();
		const cachedEntries = [...chipsPayloadCache.entries()].reverse();
		cachedEntries.forEach(([cachedKey, payload]) => {
			const cached = parseChipsRequestKey(cachedKey);
			if (!cached || cached.period !== requested.period || cached.from !== requested.from || cached.to !== requested.to) return;
			const seriesByTicker = new Map((Array.isArray(payload?.series) ? payload.series : [])
				.map((item) => [String(item?.ticker || "").trim().toUpperCase(), item]));
			const errors = payload?.errors && typeof payload.errors === "object" ? payload.errors : {};
			seriesByTicker.forEach((item, ticker) => {
				if (requestedSet.has(ticker)) reusable.set(ticker, {item});
			});
			Object.entries(errors).forEach(([ticker, error]) => {
				const normalizedTicker = String(ticker || "").trim().toUpperCase();
				if (requestedSet.has(normalizedTicker) && !reusable.has(normalizedTicker)) {
					reusable.set(normalizedTicker, {error});
				}
			});
		});
		return reusable;
	};

	const mergeCachedChipPayload = (requestKey, requestedTickers, payload) => {
		const reusable = getCachedChipEntriesForRequest(requestKey, requestedTickers);
		const incomingSeriesByTicker = new Map((Array.isArray(payload?.series) ? payload.series : [])
			.map((item) => [String(item?.ticker || "").trim().toUpperCase(), item]));
		const incomingErrors = payload?.errors && typeof payload.errors === "object" ? payload.errors : {};
		const mergedSeries = [];
		const mergedErrors = {};
		requestedTickers.forEach((ticker) => {
			const incomingItem = incomingSeriesByTicker.get(ticker);
			const cachedItem = reusable.get(ticker)?.item;
			if (incomingItem || cachedItem) {
				mergedSeries.push(incomingItem || cachedItem);
				return;
			}
			const incomingErrorKey = Object.keys(incomingErrors).find((key) => String(key || "").trim().toUpperCase() === ticker);
			const cachedError = reusable.get(ticker)?.error;
			if (incomingErrorKey) mergedErrors[ticker] = incomingErrors[incomingErrorKey];
			else if (cachedError !== undefined) mergedErrors[ticker] = cachedError;
		});
		return {
			...payload,
			series: mergedSeries,
			errors: mergedErrors,
		};
	};

	const applyChipsPayload = (payload, requestKey) => {
		if (!isChipsEnabled() || requestKey !== chipsRequestKey()) return;
		const errors = payload?.errors && typeof payload.errors === "object" ? payload.errors : {};
		const errorTickers = Object.keys(errors);
		setChipsStatus(
			errorTickers.length
				? `Chip data is unavailable for ${errorTickers.join(", ")}.`
				: "",
			errorTickers.length ? "error" : "",
		);
		renderPriceSubplots();
	};

	const usableOhlcvRowCount = (item) => (
		Array.isArray(item?.ohlcv)
			? item.ohlcv.filter((row) => (
				row?.synthetic !== true
				&& [row?.o, row?.h, row?.l, row?.c, row?.v].every((value) => finiteNumber(value) !== null)
				&& finiteNumber(row.v) > 0
			)).length
			: 0
	);

	const hasUsableOhlcv = (item) => {
		const totalRows = Array.isArray(item?.ohlcv) ? item.ohlcv.length : 0;
		const usableRows = usableOhlcvRowCount(item);
		if (!totalRows || !usableRows) return false;
		if (totalRows <= 5) return usableRows === totalRows;
		return usableRows >= Math.ceil(totalRows * 0.8);
	};

	const chipDistributionSignature = (ticker, period, source, rows, modelInputs = {}) => [
		String(ticker || "").trim().toUpperCase(),
		String(period || ""),
		source,
		finiteNumber(modelInputs.circulatingShares) ?? "",
		String(modelInputs.shareBasis || ""),
		...(Array.isArray(rows) ? rows : []).map((row) => source === "ohlcv-estimate"
			? [row?.t, row?.o, row?.h, row?.l, row?.c, row?.v, row?.synthetic === true ? 1 : 0].join(":")
			: [row?.price, row?.buy, row?.neutral, row?.sell].join(":")),
	].join("|");

	const cacheChipDistribution = (key, distribution) => {
		if (!distribution) return null;
		chipDistributionCache.set(key, distribution);
		while (chipDistributionCache.size > CHIP_DISTRIBUTION_CACHE_LIMIT) {
			chipDistributionCache.delete(chipDistributionCache.keys().next().value);
		}
		return distribution;
	};

	const resolveOhlcvChipSource = (item, fallbackItem) => [item, fallbackItem]
		.filter((candidate) => hasUsableOhlcv(candidate))
		.sort((left, right) => usableOhlcvRowCount(right) - usableOhlcvRowCount(left))[0] || null;

	const resolveChipModelInputs = (ohlcvSource, item, fallbackItem) => {
		const metadataSource = [ohlcvSource, item, fallbackItem]
			.find((candidate) => finiteNumber(candidate?.circulatingShares) !== null) || {};
		return {
			circulatingShares: finiteNumber(metadataSource.circulatingShares),
			shareBasis: metadataSource.shareBasis || "",
		};
	};

	const getCachedOhlcvChipDistribution = (item, fallbackItem, period) => {
		const calculator = window.ANTIGRAVITY_CHIP_DISTRIBUTION;
		if (!calculator) return null;
		const ohlcvSource = resolveOhlcvChipSource(item, fallbackItem);
		if (!ohlcvSource) return null;
		const modelInputs = resolveChipModelInputs(ohlcvSource, item, fallbackItem);
		const key = chipDistributionSignature(item.ticker, period, "ohlcv-estimate", ohlcvSource.ohlcv, modelInputs);
		return chipDistributionCache.get(key) || cacheChipDistribution(
			key,
			calculator.calculateChipDistribution(ohlcvSource.ohlcv, {
				binCount: CHIP_DISTRIBUTION_BIN_COUNT,
				...modelInputs,
			}),
		);
	};

	const hasRepresentativePriceLevelCoverage = (priceLevelDistribution, historicalDistribution) => {
		const priceLevelMin = finiteNumber(priceLevelDistribution?.minPrice);
		const priceLevelMax = finiteNumber(priceLevelDistribution?.maxPrice);
		const historicalMin = finiteNumber(historicalDistribution?.minPrice);
		const historicalMax = finiteNumber(historicalDistribution?.maxPrice);
		if ([priceLevelMin, priceLevelMax, historicalMin, historicalMax].some((value) => value === null)) return true;
		const historicalSpan = historicalMax - historicalMin;
		if (!Number.isFinite(historicalSpan) || historicalSpan <= 0) return true;
		const priceLevelSpan = Math.max(0, priceLevelMax - priceLevelMin);
		return (priceLevelSpan / historicalSpan) >= PRICE_LEVEL_MINIMUM_HISTORICAL_RANGE_COVERAGE;
	};

	const getChipDistribution = (item, fallbackItem, period) => {
		const calculator = window.ANTIGRAVITY_CHIP_DISTRIBUTION;
		if (!calculator) return null;
		const ohlcvDistribution = getCachedOhlcvChipDistribution(item, fallbackItem, period);
		const tradeRows = Array.isArray(fallbackItem?.trades) ? fallbackItem.trades : [];
		if (!tradeRows.length) return ohlcvDistribution;
		const key = chipDistributionSignature(item?.ticker, period, "longbridge-trade-stats", tradeRows);
		const priceLevelDistribution = chipDistributionCache.get(key) || cacheChipDistribution(
			key,
			calculator.calculatePriceLevelDistribution(tradeRows, {binCount: CHIP_DISTRIBUTION_BIN_COUNT}),
		);
		if (!priceLevelDistribution || !hasRepresentativePriceLevelCoverage(priceLevelDistribution, ohlcvDistribution)) {
			return ohlcvDistribution;
		}
		return priceLevelDistribution;
	};

	const normalizeChipSnapshotTimestamp = (value) => {
		const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
		if (!match) return "";
		return `${match[1]}-${match[2]}-${match[3]} ${match[4] || "00"}:${match[5] || "00"}`;
	};

	const findSnapshotCurrentPrice = (prices, dataIndex, rows) => {
		for (let index = Math.min(dataIndex, prices.length - 1); index >= 0; index -= 1) {
			const value = finiteNumber(prices[index]);
			if (value !== null) return value;
		}
		return finiteNumber(rows[rows.length - 1]?.c ?? rows[rows.length - 1]?.close);
	};

	const createChipSnapshotContext = ({
		item,
		fallbackItem,
		period,
		prices,
		fullState,
	}) => {
		const ohlcvSource = resolveOhlcvChipSource(item, fallbackItem);
		const historicalDistribution = getCachedOhlcvChipDistribution(item, fallbackItem, period);
		if (!ohlcvSource || !historicalDistribution) return null;
		const datedRows = ohlcvSource.ohlcv
			.map((row) => ({row, timestamp: normalizeChipSnapshotTimestamp(row?.t ?? row?.timestamp ?? row?.date)}))
			.filter(({timestamp}) => timestamp)
			.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
		if (!datedRows.length) return null;
		return {
			datedRows,
			prices,
			modelInputs: resolveChipModelInputs(ohlcvSource, item, fallbackItem),
			priceMin: historicalDistribution.minPrice,
			priceMax: historicalDistribution.maxPrice,
			fullState,
			snapshots: new Map(),
		};
	};

	const getChipSnapshotState = (context, dataIndex, cutoffDate) => {
		const calculator = window.ANTIGRAVITY_CHIP_DISTRIBUTION;
		const cutoffTimestamp = normalizeChipSnapshotTimestamp(cutoffDate);
		if (!calculator || !context || !cutoffTimestamp) return null;
		const cacheKey = `${dataIndex}:${cutoffTimestamp}`;
		const cached = context.snapshots.get(cacheKey);
		if (cached) {
			context.snapshots.delete(cacheKey);
			context.snapshots.set(cacheKey, cached);
			return cached;
		}
		const rows = context.datedRows
			.filter(({timestamp}) => timestamp <= cutoffTimestamp)
			.map(({row}) => row);
		const distribution = rows.length
			? calculator.calculateChipDistribution(rows, {
				binCount: CHIP_DISTRIBUTION_BIN_COUNT,
				...context.modelInputs,
				priceMin: context.priceMin,
				priceMax: context.priceMax,
			})
			: null;
		const currentPrice = findSnapshotCurrentPrice(context.prices, dataIndex, rows);
		const snapshot = {
			distribution,
			statistics: calculator.calculateChipStatistics(distribution, currentPrice),
			currentPrice,
			snapshotMode: "cumulative-hover",
			snapshotIndex: dataIndex,
			snapshotDate: cutoffTimestamp,
			snapshotRows: rows.length,
		};
		context.snapshots.set(cacheKey, snapshot);
		while (context.snapshots.size > CHIP_SNAPSHOT_CACHE_LIMIT) {
			context.snapshots.delete(context.snapshots.keys().next().value);
		}
		return snapshot;
	};

	const withChipPriceMapping = (chart, state) => state ? {
		...state,
		priceToCanvasY: (price) => chart.scales.y.getPixelForValue(price),
	} : null;

	const syncChipDistributionDataset = (canvas, state) => {
		const distribution = state?.distribution;
		const statistics = state?.statistics;
		const bins = Array.isArray(distribution?.bins) ? distribution.bins : [];
		canvas.dataset.chipSource = distribution?.source || "";
		canvas.dataset.chipModel = distribution?.model || "";
		canvas.dataset.chipDecayApplied = distribution?.decayApplied ? "1" : "0";
		canvas.dataset.chipShareBasis = distribution?.shareBasis || "";
		canvas.dataset.chipAverageTurnoverRate = finiteNumber(distribution?.averageTurnoverRate)?.toFixed(6) || "";
		canvas.dataset.chipCostRangeMethod = statistics?.costRangeMethod || "";
		canvas.dataset.chipBinCount = String(bins.length);
		canvas.dataset.chipRowCount = String(bins.length);
		canvas.dataset.chipPopulatedBinCount = String(bins.filter((bin) => bin.weight > 0).length);
		canvas.dataset.chipPocPrice = finiteNumber(statistics?.pocPrice)?.toFixed(6) || "";
		canvas.dataset.chipWeightedAverageCost = finiteNumber(statistics?.weightedAverageCost)?.toFixed(6) || "";
		canvas.dataset.chipProfitRatio = finiteNumber(statistics?.profitRatio)?.toFixed(6) || "";
		canvas.dataset.chipCostRange70 = Array.isArray(statistics?.costRange70) ? statistics.costRange70.join(":") : "";
		canvas.dataset.chipCostRange90 = Array.isArray(statistics?.costRange90) ? statistics.costRange90.join(":") : "";
		canvas.dataset.chipSnapshotMode = state?.snapshotMode || "full-range";
		canvas.dataset.chipSnapshotIndex = Number.isInteger(state?.snapshotIndex) ? String(state.snapshotIndex) : "";
		canvas.dataset.chipSnapshotDate = state?.snapshotDate || "";
		canvas.dataset.chipSnapshotRows = String(Math.max(0, Number(state?.snapshotRows) || 0));
	};

	const applyChipSnapshot = (dataIndex, cutoffDate) => {
		activeChipSnapshotIndex = dataIndex;
		activeChipSnapshotDate = cutoffDate;
		priceCharts.forEach((chart) => {
			const context = chart.$costDistributionContext;
			if (!context) return;
			const snapshot = getChipSnapshotState(context, dataIndex, cutoffDate);
			if (!snapshot) return;
			chart.$costDistribution = withChipPriceMapping(chart, snapshot);
			syncChipDistributionDataset(chart.canvas, snapshot);
		});
		drawSharedHoverGuides();
	};

	const scheduleChipSnapshot = (dataIndex, cutoffDate) => {
		if (activeChipSnapshotIndex === dataIndex && activeChipSnapshotDate === cutoffDate) return;
		pendingChipSnapshot = {dataIndex, cutoffDate};
		if (chipSnapshotFrame) return;
		chipSnapshotFrame = window.requestAnimationFrame(() => {
			chipSnapshotFrame = 0;
			const pending = pendingChipSnapshot;
			pendingChipSnapshot = null;
			if (pending) applyChipSnapshot(pending.dataIndex, pending.cutoffDate);
		});
	};

	const restoreFullChipDistributions = () => {
		if (chipSnapshotFrame) window.cancelAnimationFrame(chipSnapshotFrame);
		chipSnapshotFrame = 0;
		pendingChipSnapshot = null;
		activeChipSnapshotIndex = -1;
		activeChipSnapshotDate = "";
		priceCharts.forEach((chart) => {
			const fullState = chart.$costDistributionContext?.fullState;
			if (!fullState) return;
			chart.$costDistribution = withChipPriceMapping(chart, fullState);
			syncChipDistributionDataset(chart.canvas, fullState);
		});
	};

	const getChipPanelWidth = (chart) => {
		const chartWidth = Number(chart?.width || chart?.canvas?.clientWidth || 0);
		if (!Number.isFinite(chartWidth) || chartWidth <= 0) return CHIP_PANEL_MIN_WIDTH;
		return Math.round(Math.max(CHIP_PANEL_MIN_WIDTH, Math.min(CHIP_PANEL_MAX_WIDTH, chartWidth * 0.3)));
	};

	const getChipPanelBounds = (chart) => {
		const canvasWidth = Number(chart?.width || chart?.canvas?.clientWidth || 0);
		const left = Number(chart?.chartArea?.right || 0) + CHIP_PANEL_GAP;
		const right = canvasWidth - CHIP_PANEL_RIGHT_PADDING;
		return {left, right, width: Math.max(0, right - left)};
	};

	const resolveChipHoverPriceMarker = (chart, chipBins) => {
		if (chipHoverState?.chart !== chart || !chart?.chartArea || !chart.scales?.y) return null;
		const bin = chipBins?.[chipHoverState.binIndex];
		const price = finiteNumber(bin?.price);
		const rawY = price === null ? null : chart.scales.y.getPixelForValue(price);
		if (price === null || !Number.isFinite(rawY)) return null;
		const pointHoverRadius = finiteNumber(chart.data?.datasets?.[0]?.pointHoverRadius);
		return {
			price,
			x: chart.chartArea.right,
			y: Math.max(chart.chartArea.top, Math.min(chart.chartArea.bottom, rawY)),
			radius: Math.max(2, pointHoverRadius ?? CHIP_HOVER_PRICE_MARKER_RADIUS),
		};
	};

	const getThemeAlignedLogoX = (chart) => {
		const canvasWidth = Number(chart?.width || chart?.canvas?.clientWidth || 0);
		const fallbackCanvasX = Math.max(
			LOGO_SIZE / 2,
			canvasWidth - CHIP_PANEL_RIGHT_PADDING - (LOGO_SIZE / 2),
		);
		const canvasRect = chart?.canvas?.getBoundingClientRect?.();
		const themeRect = document.getElementById("global_theme_toggle")?.getBoundingClientRect?.();
		if (!canvasRect || !themeRect || canvasRect.width <= 0 || themeRect.width <= 0 || canvasWidth <= 0) {
			return {
				canvasX: fallbackCanvasX,
				anchorViewportX: null,
				resolvedViewportX: null,
				clamped: false,
			};
		}
		const anchorViewportX = themeRect.left + (themeRect.width / 2);
		const canvasScaleX = canvasWidth / canvasRect.width;
		const requestedCanvasX = (anchorViewportX - canvasRect.left) * canvasScaleX;
		const canvasX = Math.max(
			LOGO_SIZE / 2,
			Math.min(canvasWidth - (LOGO_SIZE / 2), requestedCanvasX),
		);
		return {
			canvasX,
			anchorViewportX,
			resolvedViewportX: canvasRect.left + ((canvasX / canvasWidth) * canvasRect.width),
			clamped: Math.abs(canvasX - requestedCanvasX) > 0.01,
		};
	};

	const loadChips = async () => {
		if (!isChipsEnabled() || !state.endpoints?.compareChips) return;
		const requestKey = chipsRequestKey();
		const requestedTickers = (state.chart?.series || [])
			.map((item) => String(item?.ticker || "").trim().toUpperCase())
			.filter(Boolean);
		if (!requestedTickers.length) return;
		const cached = getCachedChipsPayload(requestKey);
		if (cached) {
			applyChipsPayload(cached, requestKey);
			return;
		}
		const cachedEntries = getCachedChipEntriesForRequest(requestKey, requestedTickers);
		const missingTickers = requestedTickers.filter((ticker) => !cachedEntries.has(ticker));
		if (!missingTickers.length) return;
		if (chipsRequestController && chipsRequestKeyInFlight === requestKey) return;
		const requestSerial = ++chipsRequestSerial;
		chipsRequestController?.abort();
		const requestController = new AbortController();
		chipsRequestController = requestController;
		chipsRequestKeyInFlight = requestKey;
		setChipsStatus("", "loading", {tickers: missingTickers});
		const params = new URLSearchParams();
		const requestTickers = [...missingTickers];
		if (requestTickers.length === 1) {
			const anchorTicker = requestedTickers.find((ticker) => cachedEntries.has(ticker));
			if (anchorTicker) requestTickers.push(anchorTicker);
		}
		requestTickers.forEach((ticker) => params.append("ticker", ticker));
		const {from, to} = chipVisibleDateBounds();
		if (from && to) {
			params.set("from", from);
			params.set("to", to);
		}
		try {
			const response = await fetch(`${state.endpoints.compareChips}?${params.toString()}`, {
				headers: {Accept: "application/json"},
				signal: requestController.signal,
			});
			const payload = await response.json();
			if (requestSerial !== chipsRequestSerial || requestKey !== chipsRequestKey() || !isChipsEnabled()) return;
			if (!response.ok || !payload.success || !Array.isArray(payload.series)) {
				setChipsStatus(payload.error || "Chip distribution is unavailable.", "error");
				return;
			}
			const mergedPayload = mergeCachedChipPayload(requestKey, requestedTickers, payload);
			cacheChipsPayload(requestKey, mergedPayload);
			applyChipsPayload(mergedPayload, requestKey);
		} catch (error) {
			if (error?.name === "AbortError") return;
			if (requestSerial !== chipsRequestSerial || !isChipsEnabled()) return;
			setChipsStatus("Chip distribution is unavailable.", "error");
		} finally {
			if (chipsRequestController === requestController) {
				chipsRequestController = null;
				chipsRequestKeyInFlight = "";
			}
		}
	};

	const escapeTooltipHtml = (value) => String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

	const formatSharedTooltipDate = (value, tickers = [], {period = ""} = {}) => {
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
		if (!convertedParts || LONG_RANGE_TOOLTIP_PERIODS.has(String(period || "").toLowerCase())) return dateMarkup;
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
		tooltip.dataset.tooltipKind = "shared";
		delete tooltip.dataset.tooltipPlacement;
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
		const hasChipSnapshot = activeChipSnapshotIndex >= 0 || Boolean(pendingChipSnapshot) || chipSnapshotFrame > 0;
		if (sharedHoverIndex < 0 && !chipHoverState && !hasChipSnapshot && !document.querySelector(".price-shared-tooltip.is-visible")) return;
		sharedHoverIndex = -1;
		chipHoverState = null;
		restoreFullChipDistributions();
		document.querySelector(".price-shared-tooltip")?.classList.remove("is-visible");
		drawSharedHoverGuides();
	};

	const updateSharedHover = (dataIndex, sourceChart, event, {series, profiles, showCurrency, period}) => {
		if (!Number.isInteger(dataIndex) || dataIndex < 0 || !(sourceChart?.canvas instanceof HTMLCanvasElement)) {
			hideSharedHover();
			return;
		}
		sharedHoverIndex = dataIndex;
		chipHoverState = null;
		const tooltip = getOrCreateSharedTooltip();
		const surface = tooltip?.parentElement;
		if (!(tooltip instanceof HTMLElement) || !(surface instanceof HTMLElement)) return;
		tooltip.dataset.tooltipKind = "shared";
		const rawDates = Array.isArray(series[0]?.raw_dates) ? series[0].raw_dates : [];
		const fallbackDates = Array.isArray(series[0]?.dates) ? series[0].dates : [];
		const rawDate = rawDates[dataIndex] || fallbackDates[dataIndex] || "";
		if (rawDate) scheduleChipSnapshot(dataIndex, rawDate);
		const dateElement = tooltip.querySelector(".chart-tooltip-date");
		const listElement = tooltip.querySelector(".chart-tooltip-list");
		if (dateElement) dateElement.innerHTML = formatSharedTooltipDate(
			rawDate,
			series.map((item) => item.ticker),
			{period},
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

	const getChipBinIndexAtPoint = (chart, distribution, event) => {
		const bins = Array.isArray(distribution?.bins) ? distribution.bins : [];
		if (!bins.length || !chart?.chartArea || !chart.scales?.y) return -1;
		const pointerX = finiteNumber(event?.x);
		const pointerY = finiteNumber(event?.y);
		const bounds = getChipPanelBounds(chart);
		if (pointerX === null || pointerY === null
			|| pointerX < bounds.left || pointerX > bounds.right
			|| pointerY < chart.chartArea.top || pointerY > chart.chartArea.bottom) return -1;
		const barHitRadius = Math.max(7, (chart.chartArea.height / bins.length) * 2);
		let closestIndex = -1;
		let closestDistance = Number.POSITIVE_INFINITY;
		bins.forEach((bin, binIndex) => {
			if (bin.weight <= 0) return;
			const y = chart.scales.y.getPixelForValue(bin.price);
			const distance = Math.abs(y - pointerY);
			if (Number.isFinite(distance) && distance < closestDistance) {
				closestDistance = distance;
				closestIndex = binIndex;
			}
		});
		return closestDistance <= barHitRadius ? closestIndex : -1;
	};

	const formatChipPriceRange = (range, currency) => (
		Array.isArray(range) && range.every((value) => finiteNumber(value) !== null)
			? `${formatPrice(range[0], currency, false)}–${formatPrice(range[1], currency, false)}`
			: "—"
	);

	const updateChipHover = (binIndex, chart, event, {ticker, distribution, statistics, currentPrice, currency}) => {
		const bin = distribution?.bins?.[binIndex];
		if (!bin || !(chart?.canvas instanceof HTMLCanvasElement)) {
			hideSharedHover();
			return;
		}
		const tooltip = getOrCreateSharedTooltip();
		const surface = tooltip?.parentElement;
		if (!(tooltip instanceof HTMLElement) || !(surface instanceof HTMLElement)) return;
		tooltip.dataset.tooltipKind = "chip";
		delete tooltip.dataset.tooltipPlacement;
		sharedHoverIndex = -1;
		chipHoverState = {chart, binIndex};
		const theme = readTheme();
		const dateElement = tooltip.querySelector(".chart-tooltip-date");
		const listElement = tooltip.querySelector(".chart-tooltip-list");
		if (dateElement) {
			dateElement.innerHTML = `<span class="chart-tooltip-primary-date">${escapeTooltipHtml(`${ticker} ${formatPrice(bin.price, currency, false)}`)}</span>`;
		}
		if (listElement) {
			const entries = [
				["Estimated concentration", `${(bin.normalizedWidth * 100).toFixed(1)}% of POC`, theme.text],
				[distribution?.decayApplied ? "Estimated surviving chips" : "Estimated volume", `${formatChipVolumeFull(bin.weight)} shares`, theme.text],
				["Position", formatChipPosition(bin, currentPrice), chipBinIsLoss(bin, currentPrice) ? theme.secondary : theme.positive],
				["POC", formatPrice(statistics?.pocPrice, currency, false), theme.accent],
				["Average cost", formatPrice(statistics?.weightedAverageCost, currency, false), theme.text],
				["Profit ratio", statistics?.profitRatio === null || statistics?.profitRatio === undefined ? "—" : `${(statistics.profitRatio * 100).toFixed(1)}%`, theme.positive],
				["70% cost range", formatChipPriceRange(statistics?.costRange70, currency), theme.muted],
				["90% cost range", formatChipPriceRange(statistics?.costRange90, currency), theme.muted],
			];
			listElement.innerHTML = entries.map(([label, value, color]) => `
				<div class="chart-tooltip-row">
					<span class="chart-tooltip-dot" style="background:${escapeTooltipHtml(color)}"></span>
					<span class="chart-tooltip-label">${escapeTooltipHtml(label)}</span>
					<span class="chart-tooltip-value">${escapeTooltipHtml(value)}</span>
				</div>
			`).join("");
		}

		tooltip.classList.add("is-visible");
		const surfaceRect = surface.getBoundingClientRect();
		const canvasRect = chart.canvas.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const pointerX = finiteNumber(event?.x);
		const pointerY = finiteNumber(event?.y);
		const cursorX = canvasRect.left - surfaceRect.left + (pointerX ?? chart.chartArea.right);
		const cursorY = canvasRect.top - surfaceRect.top + (pointerY ?? chart.scales.y.getPixelForValue(bin.price));
		const padding = 12;
		const gap = 14;
		const minLeft = padding;
		const maxLeft = Math.max(minLeft, surfaceRect.width - tooltipRect.width - padding);
		const left = Math.max(minLeft, Math.min(cursorX - (tooltipRect.width / 2), maxLeft));
		const minTop = padding;
		const maxTop = Math.max(minTop, surfaceRect.height - tooltipRect.height - padding);
		const aboveTop = cursorY - tooltipRect.height - gap;
		const belowTop = cursorY + gap;
		const canPlaceAbove = aboveTop >= minTop;
		const canPlaceBelow = belowTop <= maxTop;
		const preferAbove = cursorY > (surfaceRect.height / 2);
		let placement = preferAbove ? "above" : "below";
		let top = preferAbove ? aboveTop : belowTop;
		if (placement === "above" && !canPlaceAbove && canPlaceBelow) {
			placement = "below";
			top = belowTop;
		} else if (placement === "below" && !canPlaceBelow && canPlaceAbove) {
			placement = "above";
			top = aboveTop;
		}
		top = Math.max(minTop, Math.min(top, maxTop));
		tooltip.dataset.tooltipPlacement = placement;
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
		if (!isPriceComparison() || sections.length < 2) return () => {};
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
		if (!isPriceComparison() || !window.Chart) return;
		const chipsEnabled = isChipsEnabled();
		syncChipsPresentation(chipsEnabled);
		if (!chipsEnabled) setChipsStatus();
		const series = Array.isArray(state.chart?.series) ? state.chart.series : [];
		const profiles = Array.isArray(state.chart?.profiles) ? state.chart.profiles : [];
		const chipRequestKey = chipsRequestKey();
		const chipPayload = chipsEnabled ? getCachedChipsPayload(chipRequestKey) : null;
		const requestedTickers = series
			.map((item) => String(item?.ticker || "").trim().toUpperCase())
			.filter(Boolean);
		const cachedChipEntries = chipsEnabled
			? getCachedChipEntriesForRequest(chipRequestKey, requestedTickers)
			: new Map();
		const chipSeriesByTicker = new Map(
			(Array.isArray(chipPayload?.series) ? chipPayload.series : [])
				.map((item) => [String(item?.ticker || "").trim().toUpperCase(), item]),
		);
		const chipErrorsByTicker = new Set(Object.keys(chipPayload?.errors && typeof chipPayload.errors === "object" ? chipPayload.errors : {})
			.map((ticker) => String(ticker || "").trim().toUpperCase()));
		cachedChipEntries.forEach((entry, ticker) => {
			if (entry?.item && !chipSeriesByTicker.has(ticker)) chipSeriesByTicker.set(ticker, entry.item);
			if (entry?.error !== undefined && !chipSeriesByTicker.has(ticker)) chipErrorsByTicker.add(ticker);
		});
		const hasCompleteChipPayload = requestedTickers.every((ticker) => (
			chipSeriesByTicker.has(ticker) || chipErrorsByTicker.has(ticker)
		));
		let shouldLoadFallbackChips = chipsEnabled && !hasCompleteChipPayload;
		const currencies = series.map((item) => currencyForTicker(item.ticker));
		const showCurrency = new Set(currencies).size > 1;
		const requestedPeriod = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href)?.period
			|| new URLSearchParams(window.location.search).get("period")?.toLowerCase()
			|| "";
		const sharedRawDates = Array.isArray(series[0]?.raw_dates) ? series[0].raw_dates : [];
		const pageParams = new URLSearchParams(window.location.search);
		const overnightInput = document.querySelector("#include_overnight_hours");
		const includeOvernight = pageParams.get("overnight") === "1"
			|| pageParams.get("include_overnight") === "1"
			|| Boolean(overnightInput?.checked);
		const hasUsSessionExtendedHours = sharedRawDates.some((value) => {
			const minute = parseRawMinute(value);
			return Number.isFinite(minute) && ((minute % 1440) < ((9 * 60) + 30) || (minute % 1440) >= (16 * 60));
		})
			&& sharedRawDates.some((value) => {
				const minute = parseRawMinute(value);
				return Number.isFinite(minute) && (minute % 1440) < ((9 * 60) + 30);
			})
			&& sharedRawDates.some((value) => {
				const minute = parseRawMinute(value);
				return Number.isFinite(minute) && (minute % 1440) >= (16 * 60);
			});
		const oneDayUsSessionDividerIndexes = requestedPeriod === "1d"
			&& series.some((item) => marketForTicker(item?.ticker) === "US")
			&& hasUsSessionExtendedHours
			? buildOneDayUsSessionDividerIndexes(sharedRawDates, includeOvernight)
			: [];
		const marketSessionEvents = requestedPeriod === "1d"
			? buildMarketSessionEvents(sharedRawDates, series.map((item) => item.ticker))
			: [];
		const marketSessionEventByIndex = new Map(
			marketSessionEvents.map((event) => [event.index, event]),
		);
		const theme = readTheme();
		hideSharedHover();
		destroyPriceCharts();
		let sharedYAxisWidth = Y_AXIS_MIN_WIDTH;

		document.querySelectorAll("[data-price-subplot-canvas]").forEach((canvas) => {
			const index = Number.parseInt(canvas.dataset.seriesIndex || "", 10);
			const isBottomSubplot = () => canvas.closest("[data-price-subplot]") === document.querySelector("#price_subplot_region > [data-price-subplot]:last-child");
			const item = series[index];
			if (!item) return;
			const prices = Array.isArray(item.prices) ? item.prices.map(finiteNumber) : [];
			const rawDates = Array.isArray(item.raw_dates) ? item.raw_dates : [];
			const labels = rawDates.length ? rawDates : (item.dates || []);
			const sharedXAxisDates = sharedRawDates.length === labels.length ? sharedRawDates : rawDates;
			const sharedRangeFirstIndex = 0;
			const sharedRangeLastIndex = Math.max(0, labels.length - 1);
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
			const fallbackChipItem = chipSeriesByTicker.get(String(item.ticker || "").trim().toUpperCase());
			const chipDistribution = chipsEnabled
				? getChipDistribution(item, fallbackChipItem, requestedPeriod)
				: null;
			const chipBins = Array.isArray(chipDistribution?.bins) ? chipDistribution.bins : [];
			const chipStatistics = chipsEnabled
				? window.ANTIGRAVITY_CHIP_DISTRIBUTION?.calculateChipStatistics(chipDistribution, lastPrice)
				: null;
			const fullChipState = chipDistribution ? {
				distribution: chipDistribution,
				statistics: chipStatistics,
				currentPrice: lastPrice,
				snapshotMode: "full-range",
				snapshotIndex: null,
				snapshotDate: "",
				snapshotRows: resolveOhlcvChipSource(item, fallbackChipItem)?.ohlcv?.length || 0,
			} : null;
			const chipSnapshotContext = chipsEnabled && fullChipState
				? createChipSnapshotContext({
					item,
					fallbackItem: fallbackChipItem,
					period: requestedPeriod,
					prices,
					fullState: fullChipState,
				})
				: null;
			const chipPriceMin = finiteNumber(chipDistribution?.minPrice);
			const chipPriceMax = finiteNumber(chipDistribution?.maxPrice);
			const axisPriceValues = [candlePriceMin, candlePriceMax, chipPriceMin, chipPriceMax]
				.filter((value) => value !== null);
			const axisPriceMin = axisPriceValues.length ? Math.min(...axisPriceValues) : null;
			const axisPriceMax = axisPriceValues.length ? Math.max(...axisPriceValues) : null;
			const chipPricePadding = chipPriceMin !== null && chipPriceMax !== null
				? Math.max((chipPriceMax - chipPriceMin) * 0.02, Math.abs(chipPriceMax) * 0.001)
				: 0;
			const axisPricePadding = chipBins.length
				? Math.max(candlePricePadding, chipPricePadding)
				: candlePricePadding;
			const suggestedPriceMin = axisPriceMin === null ? undefined : axisPriceMin - axisPricePadding;
			const suggestedPriceMax = axisPriceMax === null ? undefined : axisPriceMax + axisPricePadding;
			canvas.dataset.chartRenderMode = hasOneDayCandlesticks ? "candlestick" : "line";
			canvas.dataset.xAxisLabelBasis = sharedRawDates.length === labels.length ? "shared-range" : "subplot-range";
			canvas.dataset.xAxisRangeStart = sharedXAxisDates[sharedRangeFirstIndex] || "";
			canvas.dataset.xAxisRangeEnd = sharedXAxisDates[sharedRangeLastIndex] || "";
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
			canvas.dataset.oneDaySessionDividers = String(oneDayUsSessionDividerIndexes.length);
			canvas.dataset.oneDaySessionDividerIndexes = oneDayUsSessionDividerIndexes.map(({leftIndex, rightIndex}) => `${leftIndex}:${rightIndex}`).join(",");
			canvas.dataset.oneDaySessionDividerLineStyle = oneDayUsSessionDividerIndexes.length ? "solid-session-divider" : "";
			canvas.dataset.chipDistribution = chipsEnabled ? "1" : "0";
			canvas.dataset.chipSource = chipDistribution?.source || "";
			canvas.dataset.chipModel = chipDistribution?.model || "";
			canvas.dataset.chipDecayApplied = chipDistribution?.decayApplied ? "1" : "0";
			canvas.dataset.chipShareBasis = chipDistribution?.shareBasis || "";
			canvas.dataset.chipAverageTurnoverRate = finiteNumber(chipDistribution?.averageTurnoverRate)?.toFixed(6) || "";
			canvas.dataset.chipCostRangeMethod = chipStatistics?.costRangeMethod || "";
			canvas.dataset.chipBinCount = String(chipBins.length);
			canvas.dataset.chipRowCount = String(chipBins.length);
			canvas.dataset.chipPopulatedBinCount = String(chipBins.filter((bin) => bin.weight > 0).length);
			canvas.dataset.chipPocPrice = finiteNumber(chipStatistics?.pocPrice)?.toFixed(6) || "";
			canvas.dataset.chipWeightedAverageCost = finiteNumber(chipStatistics?.weightedAverageCost)?.toFixed(6) || "";
			canvas.dataset.chipProfitRatio = finiteNumber(chipStatistics?.profitRatio)?.toFixed(6) || "";
			canvas.dataset.chipCostRange70 = Array.isArray(chipStatistics?.costRange70) ? chipStatistics.costRange70.join(":") : "";
			canvas.dataset.chipCostRange90 = Array.isArray(chipStatistics?.costRange90) ? chipStatistics.costRange90.join(":") : "";
			canvas.dataset.chipLegend = "0";
			canvas.dataset.chipBaselineLine = chipsEnabled ? "none" : "";
			canvas.dataset.chipCurrentPriceLine = chipsEnabled ? "hidden" : "";
			canvas.dataset.chipHoverLine = chipsEnabled ? "muted-solid" : "";
			canvas.dataset.chipPocStyle = chipsEnabled ? "price-relative-opacity" : "";
			canvas.dataset.chipCategoryStack = chipsEnabled ? "none" : "";
			canvas.dataset.chipColorModel = chipsEnabled ? "price-relative" : "";
			canvas.dataset.chipHoverMarker = chipsEnabled ? "none" : "";
			canvas.dataset.chipHoverMarkerAxis = chipsEnabled ? "none" : "";
			canvas.dataset.chipLogoPlacement = chipsEnabled ? "panel-top-right" : "price-close";
			canvas.dataset.chipRevealMotion = chipsEnabled ? CHIP_REVEAL_MOTION_NAME : "";
			canvas.dataset.chipRevealState = chipsEnabled
				? (chipRevealMotion.active ? "running" : "settled")
				: "off";
			canvas.dataset.chipRevealProgress = chipsEnabled ? chipRevealMotion.profileProgress.toFixed(4) : "";
			canvas.dataset.chipLogoMotion = chipsEnabled ? "price-close-to-panel-top-right" : "";
			canvas.dataset.chipLogoProgress = chipsEnabled ? chipRevealMotion.logoProgress.toFixed(4) : "";

			const chipDistributionLayoutPlugin = {
				id: `priceChipDistributionLayout${index}`,
				beforeLayout(chart) {
					const currentPadding = chart.options.layout?.padding || {};
					chart.options.layout.padding = {
						...currentPadding,
						top: chipsEnabled ? CHIP_PANEL_TOP_PADDING : 8,
						right: chipsEnabled ? getChipPanelWidth(chart) + CHIP_PANEL_GAP + CHIP_PANEL_RIGHT_PADDING : RIGHT_GUTTER,
					};
				},
			};
			const chipDistributionPlugin = {
				id: `priceChipDistribution${index}`,
				beforeDatasetsDraw(chart) {
					const activeState = chart.$costDistribution || fullChipState;
					const activeDistribution = activeState?.distribution;
					const activeBins = Array.isArray(activeDistribution?.bins) ? activeDistribution.bins : [];
					if (!chipsEnabled || !activeBins.length || !chart.chartArea || !chart.scales?.y) return;
					const bounds = getChipPanelBounds(chart);
					const ctx = chart.ctx;
					ctx.save();
					ctx.beginPath();
					ctx.rect(bounds.left, chart.chartArea.top, bounds.width, chart.chartArea.height);
					ctx.clip();
					activeBins.forEach((bin) => {
						if (bin.weight <= 0 || bounds.width <= 0) return;
						const topY = chart.scales.y.getPixelForValue(bin.high);
						const bottomY = chart.scales.y.getPixelForValue(bin.low);
						if (![topY, bottomY].every(Number.isFinite)) return;
						const clippedTop = Math.max(chart.chartArea.top, Math.min(topY, bottomY));
						const clippedBottom = Math.min(chart.chartArea.bottom, Math.max(topY, bottomY));
						const rawHeight = clippedBottom - clippedTop;
						if (rawHeight <= 0) return;
						const verticalGap = Math.min(0.5, rawHeight * 0.08);
						const barHeight = Math.max(0.75, rawHeight - verticalGap);
						const barY = clippedTop + ((rawHeight - barHeight) / 2);
						const normalizedSegments = [{
							width: Math.max(0, Math.min(1, finiteNumber(bin.normalizedWidth) || 0)),
							color: chipBinIsLoss(bin, activeState.currentPrice) ? theme.secondary : theme.positive,
						}];
						let segmentX = bounds.left;
						const revealScale = chipRevealMotion.active
							? chipRevealMotion.profileProgress
							: 1;
						normalizedSegments.forEach(({width, color}) => {
							const segmentWidth = bounds.width * Math.max(0, Math.min(1, width)) * revealScale;
							if (segmentWidth <= 0) return;
							ctx.fillStyle = color;
							ctx.globalAlpha = bin.index === activeDistribution.pocIndex ? 0.68 : 0.52;
							ctx.fillRect(segmentX, barY, segmentWidth, barHeight);
							segmentX += segmentWidth;
						});
					});
					ctx.restore();

				},
				afterDatasetsDraw(chart) {
					if (!chipsEnabled || chipHoverState?.chart !== chart) return;
					const activeDistribution = (chart.$costDistribution || fullChipState)?.distribution;
					const activeBins = Array.isArray(activeDistribution?.bins) ? activeDistribution.bins : [];
					const bin = activeBins[chipHoverState.binIndex];
					if (!bin || !chart.chartArea || !chart.scales?.y) return;
					const marker = resolveChipHoverPriceMarker(chart, activeBins);
					const bounds = getChipPanelBounds(chart);
					if (!marker) return;
					chart.ctx.save();
					chart.ctx.strokeStyle = theme.muted;
					chart.ctx.globalAlpha = 0.56;
					chart.ctx.lineWidth = Math.max(0.75, 1 / Math.max(window.devicePixelRatio || 1, 1));
					chart.ctx.setLineDash([]);
					chart.ctx.beginPath();
					chart.ctx.moveTo(chart.chartArea.left, marker.y);
					chart.ctx.lineTo(bounds.right, marker.y);
					chart.ctx.stroke();
					chart.ctx.restore();
				},
			};
			const dynamicScaleWidthPlugin = {
				id: `priceDynamicScaleWidth${index}`,
				beforeUpdate(chart) {
					if (chart.options.scales?.y) {
						chart.options.scales.y.afterFit = (scale) => {
							const naturalWidth = getDynamicPriceYAxisWidth(scale);
							chart.$naturalPriceYAxisWidth = naturalWidth;
							scale.width = Math.max(sharedYAxisWidth, naturalWidth);
						};
					}
				},
				afterLayout(chart) {
					canvas.dataset.xAxisAlignment = "strict-shared-timeline";
					canvas.dataset.sharedYAxisWidth = Number(chart.scales?.y?.width || 0).toFixed(3);
					canvas.dataset.chartAreaLeft = Number(chart.chartArea?.left || 0).toFixed(3);
					canvas.dataset.chartAreaRight = Number(chart.chartArea?.right || 0).toFixed(3);
				},
			};
			const closingLogoPlugin = {
				id: `priceClosingLogo${index}`,
				afterDatasetsDraw(chart) {
					if (!chart.chartArea || lastPrice === null) return;
					const horizontalAlignment = getThemeAlignedLogoX(chart);
					const priceClosePosition = {
						x: horizontalAlignment.canvasX,
						y: chart.scales.y.getPixelForValue(lastPrice),
					};
					const panelPosition = {
						x: horizontalAlignment.canvasX,
						y: chart.chartArea.top + (LOGO_SIZE / 2),
					};
					const origin = chipsEnabled ? chipRevealLogoOrigins.get(index) : null;
					const sourcePosition = origin ? {
						x: origin.xRatio * chart.width,
						y: origin.yRatio * chart.height,
					} : priceClosePosition;
					const targetPosition = chipsEnabled ? panelPosition : priceClosePosition;
					const motionProgress = chipsEnabled && chipRevealMotion.active
						? chipRevealMotion.logoProgress
						: 1;
					const centerX = sourcePosition.x + ((targetPosition.x - sourcePosition.x) * motionProgress);
					const centerY = sourcePosition.y + ((targetPosition.y - sourcePosition.y) * motionProgress);
					if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
					chart.$closingLogoPosition = {x: centerX, y: centerY};
					chart.$closingLogoAlignment = horizontalAlignment;
					chart.canvas.dataset.logoHorizontalAlignment = "global-theme-toggle-center";
					chart.canvas.dataset.logoHorizontalCenterX = centerX.toFixed(3);
					chart.canvas.dataset.logoHorizontalAnchorViewportX = Number.isFinite(horizontalAlignment.anchorViewportX)
						? horizontalAlignment.anchorViewportX.toFixed(3)
						: "";
					chart.canvas.dataset.logoHorizontalAlignmentClamped = horizontalAlignment.clamped ? "1" : "0";
					chart.$chipRevealMotion = chipsEnabled ? {
						active: chipRevealMotion.active,
						profileProgress: chipRevealMotion.profileProgress,
						logoProgress: motionProgress,
						rawProgress: chipRevealMotion.rawProgress,
						from: sourcePosition,
						to: targetPosition,
						current: {x: centerX, y: centerY},
					} : null;
					const image = loadLogo(profile.logo_url, chart);
					if (!image?.complete || !image.naturalWidth) return;
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
					if (oneDayUsSessionDividerIndexes.length || !isShortMultiDayRange || !chart.chartArea || !chart.scales?.x) return;
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
			const oneDaySessionDividerPlugin = {
				id: `priceOneDaySessionDivider${index}`,
				beforeDatasetsDraw(chart) {
					if (!oneDayUsSessionDividerIndexes.length || !chart.chartArea || !chart.scales?.x) return;
					chart.ctx.save();
					applySessionDividerStroke(chart.ctx, theme);
					oneDayUsSessionDividerIndexes.forEach(({leftIndex, rightIndex}) => {
						const leftX = chart.scales.x.getPixelForValue(leftIndex);
						const rightX = chart.scales.x.getPixelForValue(rightIndex);
						const x = (leftX + rightX) / 2;
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
						spanGaps: !intraday,
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
						const activeCostState = chartInstance.$costDistribution || fullChipState;
						const activeDistribution = activeCostState?.distribution;
						const chipBinIndex = chipsEnabled
							? getChipBinIndexAtPoint(chartInstance, activeDistribution, event)
							: -1;
						if (chipBinIndex >= 0) {
							updateChipHover(chipBinIndex, chartInstance, event, {
								ticker: item.ticker,
								distribution: activeDistribution,
								statistics: activeCostState?.statistics,
								currentPrice: activeCostState?.currentPrice,
								currency,
							});
							return;
						}
						if (!activeElements.length) {
							hideSharedHover();
							return;
						}
						updateSharedHover(activeElements[0].index, chartInstance, event, {
							series,
							profiles,
							currencies,
							showCurrency,
							period: requestedPeriod,
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
								return tickIndex === sharedRangeFirstIndex || tickIndex === sharedRangeLastIndex
										? formatXAxisValue(sharedXAxisDates[tickIndex] || rawDates[tickIndex], intraday)
										: "";
								},
							},
						},
						y: {
							suggestedMin: suggestedPriceMin,
							suggestedMax: suggestedPriceMax,
							grid: {display: false},
							border: {display: false},
							ticks: {
								color: theme.muted,
								padding: 8,
								callback: (value, tickIndex, ticks) => formatPriceAxis(value, currency, showCurrency && tickIndex === (ticks?.length || 0) - 1),
							},
						},
					},
				},
				plugins: [chipDistributionLayoutPlugin, chipDistributionPlugin, dynamicScaleWidthPlugin, oneDaySessionDividerPlugin, multiDaySessionDividerPlugin, multiMarketSessionEventPlugin, multiMarketSessionLabelPlugin, firstDayReferencePricePlugin, oneDayPriceCandlestickPlugin, closingLogoPlugin, sharedHoverGuidePlugin],
			});
			chart.$costDistributionContext = chipSnapshotContext;
			chart.$costDistribution = chipsEnabled && fullChipState
				? withChipPriceMapping(chart, fullChipState)
				: null;
			if (chart.$costDistribution) syncChipDistributionDataset(canvas, fullChipState);
			priceCharts.set(index, chart);
			canvas.onpointermove = (event) => {
				const activeCostState = chart.$costDistribution || fullChipState;
				const activeDistribution = activeCostState?.distribution;
				const activeBins = Array.isArray(activeDistribution?.bins) ? activeDistribution.bins : [];
				if (!chipsEnabled || !activeBins.length) return;
				const rect = canvas.getBoundingClientRect();
				const scaleX = chart.width / Math.max(rect.width, 1);
				const scaleY = chart.height / Math.max(rect.height, 1);
				const point = {
					x: (event.clientX - rect.left) * scaleX,
					y: (event.clientY - rect.top) * scaleY,
				};
				const chipBinIndex = getChipBinIndexAtPoint(chart, activeDistribution, point);
				if (chipBinIndex >= 0) {
					updateChipHover(chipBinIndex, chart, point, {
						ticker: item.ticker,
						distribution: activeDistribution,
						statistics: activeCostState?.statistics,
						currentPrice: activeCostState?.currentPrice,
						currency,
					});
				} else if (chipHoverState?.chart === chart) {
					hideSharedHover();
				}
			};
			canvas.onmouseleave = hideSharedHover;
		});
		sharedYAxisWidth = Math.max(
			Y_AXIS_MIN_WIDTH,
			...[...priceCharts.values()].map((chart) => Number(chart.$naturalPriceYAxisWidth) || Y_AXIS_MIN_WIDTH),
		);
		priceCharts.forEach((chart) => chart.update("none"));
		if (chipsEnabled && !shouldLoadFallbackChips) setChipsStatus();
		if (chipsEnabled && shouldLoadFallbackChips && !chipPayload) void loadChips();
	};

	const formatLocalIsoDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	const refreshLivePrices = async () => {
		if (!isPriceComparison()) return;
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

	const bindChipsToggle = () => {
		const input = getChipsInput();
		if (!(input instanceof HTMLInputElement) || input.dataset.bound === "1") return;
		input.dataset.bound = "1";
		input.addEventListener("change", () => {
			const shouldStartChipReveal = input.checked ? prepareChipRevealMotion() : false;
			if (!input.checked) settleChipRevealMotion();
			state.comparisonChips = input.checked;
			const url = new URL(window.location.href);
			if (input.checked) url.searchParams.set("chips", "1");
			else url.searchParams.delete("chips");
			window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
			teardownPriceSubplotOrdering();
			teardownPriceSubplotOrdering = () => {};
			liveRequestSerial += 1;
			liveRequestController?.abort();
			liveRequestController = null;
			chipsRequestSerial += 1;
			chipsRequestController?.abort();
			chipsRequestController = null;
			renderPriceSubplots();
			if (shouldStartChipReveal) startChipRevealMotion();
			teardownPriceSubplotOrdering = initializePriceSubplotOrdering();
		});
	};

	bootstrap.initPriceCompareWorkspace = () => {
		bindChipsToggle();
		teardownPriceSubplotOrdering();
		teardownPriceSubplotOrdering = () => {};
		liveRequestSerial += 1;
		liveRequestController?.abort();
		liveRequestController = null;
		if (!isPriceComparison()) return;
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
		chipsRequestController?.abort();
		settleChipRevealMotion();
		teardownPriceSubplotOrdering();
		destroyPriceCharts();
	}, {once: true});
	window.addEventListener("antigravity:theme-mode-change", () => window.requestAnimationFrame(renderPriceSubplots));
})();
