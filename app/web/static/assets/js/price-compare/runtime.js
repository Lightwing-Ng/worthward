/* Code version: v1.1.0 */
((globalScope) => {
	const createSessionAxis = ({bootstrap, state, chartAxis, yAxisMinWidth}) => {
		const Y_AXIS_MIN_WIDTH = yAxisMinWidth;
		const ONE_DAY_US_SESSION_DIVIDER_MINUTES = Object.freeze([
			(9 * 60) + 30,
			16 * 60,
		]);
		const imageCache = new Map();
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
	
		// `app/core/markets/sessions.py` owns ticker market identity, timezones,
		// and session minutes. `chart-axis-utils.js` exposes its serialized
		// projection, so Price comparison keeps no suffix or timezone table.
		const marketForTicker = (ticker) => (
			String(chartAxis.resolveMarketTimeConfig(ticker)?.market || "US")
		);
	
		const timezoneForMarket = (market) => {
			const configs = Array.isArray(globalScope.WORTHWARD_MARKET_SESSIONS)
				? globalScope.WORTHWARD_MARKET_SESSIONS
				: [];
			const match = configs.find((config) => config?.market === String(market));
			return String(match?.timezone || "America/New_York");
		};
	
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
			const workspaceState = window.WORTHWARD_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href);
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
			// Opening and closing marks read the canonical session minutes; the
			// 04:00 New York mark is a pre-market reference, not a session
			// boundary, so it stays an explicit local constant.
			const sessionMinute = (market, key) => {
				const configs = Array.isArray(globalScope.WORTHWARD_MARKET_SESSIONS)
					? globalScope.WORTHWARD_MARKET_SESSIONS
					: [];
				const match = configs.find((config) => config?.market === market);
				return Number(match?.[key]);
			};
			const sessionEvent = (market, key) => {
				const minute = sessionMinute(market, key);
				if (!Number.isFinite(minute)) return null;
				return {
					market,
					timezone: timezoneForMarket(market),
					hours: Math.floor(minute / 60),
					minutes: minute % 60,
				};
			};
			const eventDefinitions = [
				sessionEvent("KR", "openMinute"),
				sessionEvent("UK", "openMinute"),
				sessionEvent("HK", "closeMinute"),
				sessionEvent("KR", "closeMinute"),
				{market: "US", timezone: timezoneForMarket("US"), hours: 4, minutes: 0},
			].filter(Boolean);
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
	

		return {
			applySessionDividerStroke,
			buildIntradayDayGroups,
			buildMarketSessionEvents,
			buildOneDayUsSessionDividerIndexes,
			currencyForTicker,
			dateSerial,
			drawContainedLogo,
			finiteNumber,
			formatPrice,
			formatPriceAxis,
			formatPriceCompareHeadingDate,
			formatSingleDayXAxisValue,
			formatXAxisDate,
			formatXAxisValue,
			getDynamicPriceYAxisWidth,
			layoutMarketSessionLabels,
			loadLogo,
			marketForTicker,
			parseRawMinute,
			readTheme,
			timezoneForMarket,
			timezoneLabel,
			updatePriceCompareHeadingDate,
		};
	};

	const createChipRevealController = ({priceCharts, isChipsEnabled}) => {
		const CHIP_REVEAL_MOTION_KEY = "price-compare-chip-reveal";
		const CHIP_REVEAL_FALLBACK_DURATION = 620;
		let cancelChipRevealMotion = null;
		let chipRevealLogoOrigins = new Map();
		const chipRevealMotion = {
			active: false,
			generation: 0,
			profileProgress: 1,
			logoProgress: 1,
			rawProgress: 1,
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
			if (window.WorthwardMotion?.isReducedMotion?.()) return false;
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
			const motion = window.WorthwardMotion;
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
	

		return {
			chipRevealMotion,
			getChipRevealLogoOrigins: () => chipRevealLogoOrigins,
			prepareChipRevealMotion,
			settleChipRevealMotion,
			startChipRevealMotion,
		};
	};

	globalScope.WORTHWARD_PRICE_COMPARE_RUNTIME = Object.freeze({
		VERSION: "v1.1.0",
		createChipRevealController,
		createSessionAxis,
	});
})(typeof window === "undefined" ? globalThis : window);
