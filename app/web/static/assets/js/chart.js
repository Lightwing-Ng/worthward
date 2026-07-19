/* Code version: v0.9.1 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const chartThemeState = bootstrap.chartThemeState = bootstrap.chartThemeState || {};
	const ONE_DAY_COMPARE_SESSION_MARKERS = Object.freeze([
		{ minutes: (4 * 60), timeLabel: "04:00", align: "left" },
		{ minutes: (9 * 60) + 30, timeLabel: "09:30", align: "center" },
		{ minutes: (16 * 60), timeLabel: "16:00", align: "center" },
		{ minutes: (20 * 60), timeLabel: "20:00", align: "right" },
	]);
	const ONE_DAY_COMPARE_DIVIDER_MINUTES = Object.freeze([
		(9 * 60) + 30,
		16 * 60,
	]);
	const ONE_DAY_COMPARE_REGULAR_SESSION_MARKERS = Object.freeze([
		{ minutes: (9 * 60) + 30, timeLabel: "09:30", align: "left" },
		{ minutes: 12 * 60, timeLabel: "12:00", align: "center" },
		{ minutes: 14 * 60, timeLabel: "14:00", align: "center" },
		{ minutes: 16 * 60, timeLabel: "16:00", align: "right" },
	]);
	const MAX_INTRADAY_CONNECTED_GAP_MINUTES = 5;

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
		const cleanups = [];
		if (typeof media.addEventListener === "function") {
			media.addEventListener("change", handler);
			cleanups.push(() => media.removeEventListener("change", handler));
		} else if (typeof media.addListener === "function") {
			media.addListener(handler);
			cleanups.push(() => media.removeListener(handler));
		}
		window.addEventListener("antigravity:theme-mode-change", handler);
		cleanups.push(() => window.removeEventListener("antigravity:theme-mode-change", handler));
		chartThemeState.mediaCleanup = () => cleanups.forEach((cleanup) => cleanup());
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

	const formatPercentAxisLabel = (value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return "";
		return `${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
	};

	const formatPercentTooltipLabel = (value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return "";
		return `${numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
	};

	const formatMarketCapLabel = (value, maximumFractionDigits = 2) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return "";
		const units = [
			{threshold: 1e12, suffix: "T"},
			{threshold: 1e9, suffix: "B"},
			{threshold: 1e6, suffix: "M"},
		];
		const unit = units.find((item) => Math.abs(numeric) >= item.threshold);
		if (!unit) return `$${numeric.toLocaleString("en-US", {maximumFractionDigits: 0})}`;
		return `$${(numeric / unit.threshold).toLocaleString("en-US", {
			minimumFractionDigits: maximumFractionDigits,
			maximumFractionDigits,
		})}${unit.suffix}`;
	};

	const toFiniteChartNumber = (value) => {
		if (value === null || value === undefined || value === "") return null;
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	};

	const isFiniteChartValue = (value) => toFiniteChartNumber(value) !== null;

	const readPxToken = (element, tokenName, fallbackValue) => {
		if (!(element instanceof Element)) return fallbackValue;
		const rawValue = getComputedStyle(element).getPropertyValue(tokenName).trim();
		const parsed = Number.parseFloat(rawValue);
		return Number.isFinite(parsed) ? parsed : fallbackValue;
	};

	const collectFiniteValues = (datasets) => {
		if (!Array.isArray(datasets)) return [];
		return datasets.flatMap((dataset) => (Array.isArray(dataset) ? dataset : []))
			.map((value) => toFiniteChartNumber(value))
			.filter((value) => value !== null);
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

	const drawContainedImage = (ctx, image, drawX, drawY, boxSize, padding = 2) => {
		const sourceWidth = Number(image?.naturalWidth || 0);
		const sourceHeight = Number(image?.naturalHeight || 0);
		if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
			return;
		}
		const contentSize = Math.max(1, boxSize - (Math.max(0, padding) * 2));
		const scale = Math.min(contentSize / sourceWidth, contentSize / sourceHeight);
		const drawWidth = sourceWidth * scale;
		const drawHeight = sourceHeight * scale;
		const offsetX = drawX + ((boxSize - drawWidth) / 2);
		const offsetY = drawY + ((boxSize - drawHeight) / 2);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
	};

	const drawStandardLogoBadge = (ctx, drawX, drawY, boxSize) => {
		const centerX = drawX + (boxSize / 2);
		const centerY = drawY + (boxSize / 2);
		const radius = boxSize / 2;
		ctx.fillStyle = "#fff";
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
		ctx.fill();
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
		const isMarketCapView = state.currentView === "market-caps";
		const selectedTradingDate = String(chartState.tradingDate || "");
		if (!series || !series.length) return;
		canvas.dataset.chartMounted = "1";
		["glowPlugin", "zeroBandPlugin", "multiDaySessionGuidePlugin", "oneDaySessionGuidePlugin", "oneDayCandlestickPlugin", "hoverGuidePlugin", "compareLiveMarkerPlugin", "lineEndLogoPlugin", "xAxisLabelPlugin"].forEach((pluginId) => {
			try {
				const registeredPlugin = Chart.registry?.plugins?.get?.(pluginId);
				if (registeredPlugin) Chart.unregister(registeredPlugin);
			} catch (_error) {
			}
		});
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
			image.onload = () => {
				if (!chartInstance.canvas?.isConnected || window.Chart?.getChart?.(chartInstance.canvas) !== chartInstance) return;
				chartInstance.update("none");
			};
			image.onerror = () => logoCache.delete(url);
			logoCache.set(url, image);
			return image;
		};

		const labels = series[0].dates;
		const rawDates = Array.isArray(series[0].raw_dates) ? series[0].raw_dates : [];
		const pageParams = new URLSearchParams(window.location.search);
		const selectedPeriod = pageParams.get("period")?.trim().toLowerCase() || "";
		const selectedTradingDateParam = pageParams.get("trading_date")
			|| pageParams.get("exact_trading_date")
			|| pageParams.get("from")
			|| pageParams.get("exact_start")
			|| "";
		const formatLocalIsoDate = (date = new Date()) => {
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			return `${year}-${month}-${day}`;
		};
		const refreshTransition = consumeChartWorkspaceRefreshTransition(state.currentView);
		const chartWrap = canvas.closest(".chart-wrap") || canvas.parentElement;
		const chartYPaddingPx = readPxToken(chartWrap, "--trade-chart-y-padding-px", 5);
		const previousSeriesMap = new Map((refreshTransition?.series || []).map((item) => [item.ticker, item]));
		const formatFullDateParts = bootstrap.dateDisplay?.formatFullDateParts;
		const formatFullDateLines = bootstrap.dateDisplay?.formatFullDateLines;
		const portfolioLabelMap = {
			PORTFOLIO: "Portfolio",
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
				if (isMarketCapView) return;
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

		const normalizeDateKey = (value) => {
			const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
			return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
		};

		const getRawDateMinuteOfDay = (value) => {
			const match = String(value || "").match(/(?:[T ](\d{2}):(\d{2}))$/);
			if (!match) return null;
			const hours = Number(match[1]);
			const minutes = Number(match[2]);
			if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
			return (hours * 60) + minutes;
		};

		const getRawDateSerialMinute = (value) => {
			const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
			if (!match) return null;
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			const hours = match[4] ? Number(match[4]) : 0;
			const minutes = match[5] ? Number(match[5]) : 0;
			if (![year, month, day, hours, minutes].every(Number.isFinite)) return null;
			return Math.floor(Date.UTC(year, month - 1, day) / 60000) + (hours * 60) + minutes;
		};

		const formatSerialMinuteTime = (serialMinute) => {
			const markerDate = new Date(serialMinute * 60000);
			const hours = String(markerDate.getUTCHours()).padStart(2, "0");
			const minutes = String(markerDate.getUTCMinutes()).padStart(2, "0");
			return `${hours}:${minutes}`;
		};

		const formatSerialMinuteDate = (serialMinute) => {
			const markerDate = new Date(serialMinute * 60000);
			const markerParts = {
				year: markerDate.getUTCFullYear(),
				monthIndex: markerDate.getUTCMonth(),
				day: markerDate.getUTCDate(),
			};
			return typeof formatFullDateParts === "function"
				? formatFullDateParts(markerParts)
				: `${markerParts.day}/${markerParts.monthIndex + 1}/${markerParts.year}`;
		};

		const resolveMarketTimeConfig = (ticker) => {
			const normalized = String(ticker || "").toUpperCase();
			const configs = [
				{ suffixes: [".KS", ".KQ"], timezone: "Asia/Seoul", label: "KST", session: { open: 9 * 60, close: 15 * 60 + 30 } },
				{ suffixes: [".HK"], timezone: "Asia/Hong_Kong", label: "HKT", session: { open: (9 * 60) + 30, close: 16 * 60 } },
				{ suffixes: [".T", ".JP"], timezone: "Asia/Tokyo", label: "JST", session: { open: 9 * 60, close: 15 * 60 + 30 } },
				{ suffixes: [".SH", ".SS", ".SZ"], timezone: "Asia/Shanghai", label: "CST", session: { open: (9 * 60) + 30, close: 15 * 60 } },
				{ suffixes: [".SG", ".SI"], timezone: "Asia/Singapore", label: "SGT", session: { open: 9 * 60, close: 17 * 60 } },
				{ suffixes: [".L"], timezone: "Europe/London", label: "LON", session: { open: 8 * 60, close: (16 * 60) + 30 } },
				{ suffixes: [".AX"], timezone: "Australia/Sydney", label: "AET", session: { open: 10 * 60, close: 16 * 60 } },
				{ suffixes: [".TO", ".V", ".NE", ".CN", ".CA"], timezone: "America/Toronto", label: "ET", session: { open: (9 * 60) + 30, close: 16 * 60 } },
				{ suffixes: [".PA", ".AS", ".BR", ".MI", ".MC", ".DE", ".F", ".HM", ".BE", ".DU", ".MU", ".HA", ".SW", ".VI", ".ST", ".CO", ".OL", ".IR", ".IS"], timezone: "Europe/Paris", label: "CET", session: { open: 9 * 60, close: (17 * 60) + 30 } },
				{ suffixes: [".HE"], timezone: "Europe/Helsinki", label: "EET", session: { open: 9 * 60, close: (17 * 60) + 30 } },
				{ suffixes: [".NS", ".BO"], timezone: "Asia/Kolkata", label: "IST", session: { open: (9 * 60) + 15, close: (15 * 60) + 30 } },
				{ suffixes: [".TW", ".TWO"], timezone: "Asia/Taipei", label: "CST", session: { open: 9 * 60, close: (13 * 60) + 30 } },
				{ suffixes: [".KL"], timezone: "Asia/Kuala_Lumpur", label: "MYT", session: { open: 9 * 60, close: 17 * 60 } },
				{ suffixes: [".BK"], timezone: "Asia/Bangkok", label: "ICT", session: { open: 10 * 60, close: (16 * 60) + 30 } },
				{ suffixes: [".JK"], timezone: "Asia/Jakarta", label: "WIB", session: { open: 9 * 60, close: 16 * 60 } },
				{ suffixes: [".NZ"], timezone: "Pacific/Auckland", label: "NZT", session: { open: 10 * 60, close: (16 * 60) + 45 } },
				{ suffixes: [".SA"], timezone: "America/Sao_Paulo", label: "BRT", session: { open: 10 * 60, close: 17 * 60 } },
				{ suffixes: [".BA", ".MX"], timezone: "America/Mexico_City", label: "CT", session: { open: (8 * 60) + 30, close: 15 * 60 } },
				{ suffixes: [".TA"], timezone: "Asia/Jerusalem", label: "IST", session: { open: (9 * 60) + 30, close: (17 * 60) + 30 } },
				{ suffixes: [".SR", ".SE"], timezone: "Asia/Riyadh", label: "AST", session: { open: 10 * 60, close: 15 * 60 } },
				{ suffixes: [".JO"], timezone: "Africa/Johannesburg", label: "SAST", session: { open: 9 * 60, close: 17 * 60 } },
				{ suffixes: [".QA"], timezone: "Asia/Qatar", label: "AST", session: { open: (9 * 60) + 30, close: (13 * 60) + 10 } },
			];
			const match = configs.find((config) => config.suffixes.some((suffix) => normalized.endsWith(suffix)));
			if (match) return match;
			return { timezone: "America/New_York", label: "NYT", session: { open: (9 * 60) + 30, close: 16 * 60 } };
		};

		const getTimezoneOffsetMinutes = (timezone, utcMs) => {
			try {
				const parts = new Intl.DateTimeFormat("en-US", {
					timeZone: timezone,
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
					hourCycle: "h23",
				}).formatToParts(new Date(utcMs));
				const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
				const localAsUtcMs = Date.UTC(
					Number(values.year),
					Number(values.month) - 1,
					Number(values.day),
					Number(values.hour),
					Number(values.minute),
				);
				return Math.round((localAsUtcMs - utcMs) / 60000);
			} catch (_error) {
				return 0;
			}
		};

		const formatSerialMinuteLocalTime = (serialMinute, config) => {
			if (!Number.isFinite(serialMinute) || !config) return "";
			const rawNewYorkMs = serialMinute * 60000;
			const newYorkOffset = getTimezoneOffsetMinutes("America/New_York", rawNewYorkMs);
			const actualUtcMs = rawNewYorkMs - (newYorkOffset * 60000);
			const marketOffset = getTimezoneOffsetMinutes(config.timezone, actualUtcMs);
			const localDate = new Date(actualUtcMs + (marketOffset * 60000));
			const hours = String(localDate.getUTCHours()).padStart(2, "0");
			const minutes = String(localDate.getUTCMinutes()).padStart(2, "0");
			return `${hours}:${minutes} ${config.label}`;
		};

		const getSerialMinuteMarketDateParts = (serialMinute, config) => {
			if (!Number.isFinite(serialMinute) || !config) return null;
			const rawNewYorkMs = serialMinute * 60000;
			const newYorkOffset = getTimezoneOffsetMinutes("America/New_York", rawNewYorkMs);
			const actualUtcMs = rawNewYorkMs - (newYorkOffset * 60000);
			const marketOffset = getTimezoneOffsetMinutes(config.timezone, actualUtcMs);
			const localDate = new Date(actualUtcMs + (marketOffset * 60000));
			return {
				year: localDate.getUTCFullYear(),
				monthIndex: localDate.getUTCMonth(),
				day: localDate.getUTCDate(),
			};
		};

		const formatDatePartsKey = (dateParts) => {
			if (!dateParts) return "";
			const year = String(dateParts.year).padStart(4, "0");
			const month = String(dateParts.monthIndex + 1).padStart(2, "0");
			const day = String(dateParts.day).padStart(2, "0");
			return `${year}-${month}-${day}`;
		};

		const localMarketMinuteToNewYorkSerialMinute = (dateText, marketMinute, config) => {
			if (!dateText || !config || !Number.isFinite(marketMinute)) return null;
			const match = String(dateText).match(/^(\d{4})-(\d{2})-(\d{2})/);
			if (!match) return null;
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			if (![year, month, day].every(Number.isFinite)) return null;
			const localWallUtcMs = Date.UTC(year, month - 1, day, Math.floor(marketMinute / 60), marketMinute % 60);
			const marketOffset = getTimezoneOffsetMinutes(config.timezone, localWallUtcMs);
			const actualUtcMs = localWallUtcMs - (marketOffset * 60000);
			const newYorkOffset = getTimezoneOffsetMinutes("America/New_York", actualUtcMs);
			const newYorkWallMs = actualUtcMs + (newYorkOffset * 60000);
			return Math.round(newYorkWallMs / 60000);
		};

		const buildCrossMarketTooltipHtml = (pointIndex) => {
			if (!isCrossMarketOneDayRange) return "";
			const serialMinute = getRawDateSerialMinute(rawDates[pointIndex]);
			if (!Number.isFinite(serialMinute)) return "";
			const dateLine = selectedTradingDate
				? formatSerialMinuteDate(getRawDateSerialMinute(selectedTradingDate))
				: formatSerialMinuteDate(serialMinute);
			const timeLines = series.map((item) => {
				const config = resolveMarketTimeConfig(item?.ticker);
				const timeText = formatSerialMinuteLocalTime(serialMinute, config);
				return timeText ? `<span class="chart-tooltip-market-time">${timeText}</span>` : "";
			}).filter(Boolean).join("");
			return `
				<span class="chart-tooltip-primary-date">${dateLine}</span>
				${timeLines ? `<span class="chart-tooltip-market-times">${timeLines}</span>` : ""}
			`;
		};

		const buildCrossMarketTickDefinitions = () => {
			if (!Number.isFinite(crossMarketWindowStartLabelMinute) || !Number.isFinite(crossMarketWindowEndLabelMinute) || !Number.isFinite(crossMarketWindowStartBoundaryMinute) || !Number.isFinite(crossMarketWindowEndBoundaryMinute)) return [];
			const totalWindowMinutes = crossMarketWindowEndBoundaryMinute - crossMarketWindowStartBoundaryMinute;
			const labeledWindowMinutes = crossMarketWindowEndLabelMinute - crossMarketWindowStartLabelMinute;
			if (totalWindowMinutes <= 0) return [];
			const tickCount = totalWindowMinutes >= 360 ? 4 : 3;
			const indexes = tickCount === 4 ? [0, 1, 2, 3] : [0, 1, 2];
			return indexes.map((index) => {
				const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
				const serialMinute = Math.round(crossMarketWindowStartLabelMinute + (labeledWindowMinutes * ratio));
				return {
					xRatio: (serialMinute - crossMarketWindowStartBoundaryMinute) / totalWindowMinutes,
					align: index === 0 ? "left" : index === tickCount - 1 ? "right" : "center",
					firstLine: formatSerialMinuteTime(serialMinute),
					secondLine: formatSerialMinuteDate(serialMinute),
				};
			});
		};

		const buildCrossMarketGuideRatios = () => {
			if (!Number.isFinite(crossMarketWindowStartBoundaryMinute) || !Number.isFinite(crossMarketWindowEndBoundaryMinute)) return [];
			const totalWindowMinutes = crossMarketWindowEndBoundaryMinute - crossMarketWindowStartBoundaryMinute;
			if (totalWindowMinutes <= 0) return [];
			const markerMinutes = new Set();
			series.forEach((item) => {
				const config = resolveMarketTimeConfig(item?.ticker);
				const openMinute = localMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.session?.open, config);
				const closeBoundaryMinute = localMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.session?.close, config);
				[
					Number.isFinite(openMinute) ? openMinute - 0.5 : null,
					Number.isFinite(closeBoundaryMinute) ? closeBoundaryMinute : null,
				].forEach((boundaryMinute) => {
					if (!Number.isFinite(boundaryMinute)) return;
					if (boundaryMinute < crossMarketWindowStartBoundaryMinute || boundaryMinute > crossMarketWindowEndBoundaryMinute) return;
					markerMinutes.add(boundaryMinute);
				});
			});
			return Array.from(markerMinutes)
				.sort((left, right) => left - right)
				.map((serialMinute) => (serialMinute - crossMarketWindowStartBoundaryMinute) / totalWindowMinutes)
				.filter((ratio) => ratio >= 0 && ratio <= 1);
		};

		const getOneDayTimestampRatio = (value) => {
			if (isCrossMarketOneDayRange && Number.isFinite(crossMarketWindowStartBoundaryMinute) && Number.isFinite(crossMarketWindowEndBoundaryMinute)) {
				const serialMinute = getRawDateSerialMinute(value);
				if (!Number.isFinite(serialMinute)) return null;
				const elapsedMinutes = serialMinute - crossMarketWindowStartBoundaryMinute;
				const totalWindowMinutes = crossMarketWindowEndBoundaryMinute - crossMarketWindowStartBoundaryMinute;
				if (totalWindowMinutes <= 0) return null;
				return Math.min(1, Math.max(0, elapsedMinutes / totalWindowMinutes));
			}
			const minuteOfDay = getRawDateMinuteOfDay(value);
			if (!Number.isFinite(minuteOfDay)) return null;
			const totalSessionMinutes = oneDaySessionEndMinute - oneDaySessionStartMinute;
			if (totalSessionMinutes <= 0) return null;
			return Math.min(1, Math.max(0, (minuteOfDay - oneDaySessionStartMinute) / totalSessionMinutes));
		};

		const hasMeaningfulIntradayTime = (value) => {
			const match = String(value || "").match(/(?:[T ](\d{2}):(\d{2}))$/);
			if (!match) return false;
			const hours = Number(match[1]);
			const minutes = Number(match[2]);
			if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
			return hours !== 0 || minutes !== 0;
		};

		const hasIntradayLabels = rawDates.some((value) => hasMeaningfulIntradayTime(value));
		const isCompareOneDayRange = state.currentView === "tickers" && selectedPeriod === "1d" && hasIntradayLabels;
		const shortMultiDayMarketConfig = resolveMarketTimeConfig(series[0]?.ticker);
		const getShortMultiDayDateParts = (index) => (
			getSerialMinuteMarketDateParts(getRawDateSerialMinute(rawDates[index]), shortMultiDayMarketConfig)
		);
		const uniqueIntradayDateKeys = Array.from(new Set(rawDates.map((_value, index) => formatDatePartsKey(getShortMultiDayDateParts(index)) || normalizeDateKey(rawDates[index])).filter(Boolean)));
		const isExactCompareRange = state.currentView === "tickers" && (pageParams.get("range") || pageParams.get("range_mode") || "").trim().toLowerCase() === "exact";
		const isCompareShortMultiDayRange = isExactCompareRange
			&& hasIntradayLabels
			&& uniqueIntradayDateKeys.length >= 2
			&& uniqueIntradayDateKeys.length <= 5;
		const isCrossMarketOneDayRange = isCompareOneDayRange && series.some((item) => /\.(AS|AX|BA|BE|BK|BO|BR|CA|CN|CO|DE|DU|F|HA|HE|HK|HM|IR|IS|JK|JP|KL|KQ|KS|L|MC|MI|MX|NE|NS|NZ|OL|PA|QA|SA|SE|SG|SH|SI|SR|SS|ST|SW|SZ|TA|T|TO|TWO|TW|V|VI)$/i.test(String(item?.ticker || "")));
		const crossMarketSessionWindows = isCrossMarketOneDayRange
			? series.flatMap((item) => {
				const config = resolveMarketTimeConfig(item?.ticker);
				const openMinute = localMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.session?.open, config);
				const closeBoundaryMinute = localMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.session?.close, config);
				if (!Number.isFinite(openMinute) || !Number.isFinite(closeBoundaryMinute)) return [];
				return [{
					openCenter: openMinute,
					startBoundary: openMinute - 0.5,
					closeLabel: closeBoundaryMinute,
					closeBoundary: closeBoundaryMinute,
				}];
			})
			: [];
		const crossMarketWindowStartLabelMinute = crossMarketSessionWindows.length
			? Math.min(...crossMarketSessionWindows.map((item) => item.openCenter))
			: null;
		const crossMarketWindowEndLabelMinute = crossMarketSessionWindows.length
			? Math.max(...crossMarketSessionWindows.map((item) => item.closeLabel))
			: null;
		const crossMarketWindowStartBoundaryMinute = crossMarketSessionWindows.length
			? Math.min(...crossMarketSessionWindows.map((item) => item.startBoundary))
			: null;
		const crossMarketWindowEndBoundaryMinute = crossMarketSessionWindows.length
			? Math.max(...crossMarketSessionWindows.map((item) => item.closeBoundary))
			: null;
		const hasOneDayExtendedHours = isCompareOneDayRange && rawDates.some((value) => {
			const minuteOfDay = getRawDateMinuteOfDay(value);
			return Number.isFinite(minuteOfDay) && (minuteOfDay < ((9 * 60) + 30) || minuteOfDay >= (16 * 60));
		});
		const oneDaySessionStartMinute = hasOneDayExtendedHours ? (4 * 60) : ((9 * 60) + 30);
		const oneDaySessionEndMinute = hasOneDayExtendedHours ? (20 * 60) : (16 * 60);
		const hasDrawableOneDayCandles = (item) => (
			Array.isArray(item?.candlestick_returns)
			&& item.candlestick_returns.length === labels.length
			&& item.candlestick_returns.some((candle) => {
				const volume = toFiniteChartNumber(candle?.v);
				return candle?.synthetic !== true
					&& (volume === null || volume > 0)
					&& [candle?.o, candle?.h, candle?.l, candle?.c].every(isFiniteChartValue);
			})
		);
		const hasOneDayCandlesticks = isCompareOneDayRange
			&& !isCrossMarketOneDayRange
			&& series.every(hasDrawableOneDayCandles);
		canvas.dataset.chartRenderMode = hasOneDayCandlesticks ? "candlestick" : "line";

		const buildOneDaySessionTickDefinitions = () => {
			const anchorDateParts = parseRawDate(rawDates[0]);
			if (!anchorDateParts) return [];
			if (isCrossMarketOneDayRange) return buildCrossMarketTickDefinitions();
			const totalSessionMinutes = oneDaySessionEndMinute - oneDaySessionStartMinute;
			const markers = hasOneDayExtendedHours ? ONE_DAY_COMPARE_SESSION_MARKERS : ONE_DAY_COMPARE_REGULAR_SESSION_MARKERS;
			return markers.map((marker) => ({
				xRatio: totalSessionMinutes > 0 ? (marker.minutes - oneDaySessionStartMinute) / totalSessionMinutes : 0,
				align: marker.align,
				firstLine: marker.timeLabel,
				secondLine: typeof formatFullDateParts === "function"
					? formatFullDateParts({
						year: anchorDateParts.year,
						monthIndex: anchorDateParts.monthIndex,
						day: anchorDateParts.day,
					})
					: `${anchorDateParts.day}/${anchorDateParts.monthIndex + 1}/${anchorDateParts.year}`,
			}));
		};

		const buildOneDaySessionDividerRatios = () => {
			if (isCrossMarketOneDayRange) {
				return buildCrossMarketGuideRatios();
			}
			if (!hasOneDayExtendedHours) return [];
			const totalSessionMinutes = oneDaySessionEndMinute - oneDaySessionStartMinute;
			if (totalSessionMinutes <= 0) return [];
			return ONE_DAY_COMPARE_DIVIDER_MINUTES.map((minutes) => (
				(minutes - oneDaySessionStartMinute) / totalSessionMinutes
			)).filter((ratio) => ratio > 0 && ratio < 1);
		};

		const buildShortMultiDayGroups = () => {
			if (!isCompareShortMultiDayRange) return [];
			const groups = [];
			rawDates.forEach((value, index) => {
				const dateKey = formatDatePartsKey(getShortMultiDayDateParts(index)) || normalizeDateKey(value);
				if (!dateKey) return;
				const current = groups[groups.length - 1];
				if (current?.dateKey === dateKey) {
					current.endIndex = index;
					return;
				}
				groups.push({ dateKey, startIndex: index, endIndex: index });
			});
			return groups;
		};

		const xAxisLabelPlugin = {
			id: "xAxisLabelPlugin",
			afterDraw(chartInstance) {
				const { ctx, chartArea, scales } = chartInstance;
				const xScale = scales?.x;
				if (!chartArea || !xScale || !labels.length) return;
				const baselineY = chartArea.bottom;
				ctx.save();
				ctx.fillStyle = resolvedTheme.muted;
				const axisFontSize = readPxToken(chartInstance.canvas, "--workspace-share-chart-axis-font-size", 12);
				const lineHeight = Math.round(axisFontSize * 1.08);
				ctx.font = `400 ${axisFontSize}px "GDS Transport", "Helvetica Neue", Arial, sans-serif`;
				ctx.textBaseline = "top";
				if (isCompareOneDayRange) {
					const sessionTicks = buildOneDaySessionTickDefinitions();
					sessionTicks.forEach((tickDef, tickIndex) => {
						const x = chartArea.left + (chartArea.width * tickDef.xRatio);
						if (!Number.isFinite(x)) return;
						if (tickDef.align === "left" || tickIndex === 0) ctx.textAlign = "left";
						else if (tickDef.align === "right" || tickIndex === sessionTicks.length - 1) ctx.textAlign = "right";
						else ctx.textAlign = "center";
						ctx.fillText(tickDef.firstLine, x, baselineY + 4);
						ctx.fillText(tickDef.secondLine, x, baselineY + 4 + lineHeight);
					});
					ctx.restore();
					return;
				}
				if (isCompareShortMultiDayRange) {
					buildShortMultiDayGroups().forEach((group) => {
						const parsedDate = getShortMultiDayDateParts(group.startIndex);
						if (!parsedDate) return;
						const [firstLine, secondLine] = formatChartDateLines({
							year: parsedDate.year,
							monthIndex: parsedDate.monthIndex,
							day: parsedDate.day,
						});
						const startX = xScale.getPixelForValue(group.startIndex);
						const endX = xScale.getPixelForValue(group.endIndex);
						const x = (startX + endX) / 2;
						if (!Number.isFinite(x)) return;
						ctx.textAlign = "center";
						ctx.fillText(firstLine, x, baselineY + 4);
						ctx.fillText(secondLine, x, baselineY + 4 + lineHeight);
					});
					ctx.restore();
					return;
				}
				const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
				const tickIndexes = buildChartTickIndexes(labels, rawDates, viewportWidth, hasIntradayLabels);
				tickIndexes.forEach((index, tickIndex) => {
					const parsedDate = parseRawDate(rawDates[index]);
					if (!parsedDate) return;
					const [firstLine, secondLine] = formatChartDateLines(parsedDate);
					const x = xScale.getPixelForValue(index);
					if (!Number.isFinite(x)) return;
					if (tickIndex === 0) ctx.textAlign = "left";
					else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = "right";
					else ctx.textAlign = "center";
					ctx.fillText(firstLine, x, baselineY + 4);
					ctx.fillText(secondLine, x, baselineY + 4 + lineHeight);
				});
				ctx.restore();
			},
		};

		const multiDaySessionGuidePlugin = {
			id: "multiDaySessionGuidePlugin",
			beforeDatasetsDraw(chartInstance) {
				if (!isCompareShortMultiDayRange) return;
				const { ctx, chartArea, scales } = chartInstance;
				const xScale = scales?.x;
				if (!chartArea || !xScale) return;
				const groups = buildShortMultiDayGroups();
				if (groups.length < 2) return;
				ctx.save();
				ctx.strokeStyle = resolvedTheme.muted;
				ctx.globalAlpha = 0.22;
				ctx.lineWidth = 1;
				groups.slice(1).forEach((group) => {
					const previousX = xScale.getPixelForValue(group.startIndex - 1);
					const currentX = xScale.getPixelForValue(group.startIndex);
					const x = (previousX + currentX) / 2;
					if (!Number.isFinite(x)) return;
					ctx.beginPath();
					ctx.moveTo(x, chartArea.top);
					ctx.lineTo(x, chartArea.bottom);
					ctx.stroke();
				});
				ctx.restore();
			},
		};

		const oneDaySessionGuidePlugin = {
			id: "oneDaySessionGuidePlugin",
			beforeDatasetsDraw(chartInstance) {
				if (!isCompareOneDayRange) return;
				const { ctx, chartArea } = chartInstance;
				if (!chartArea) return;
				const dividerRatios = buildOneDaySessionDividerRatios();
				if (!dividerRatios.length) return;
				ctx.save();
				ctx.strokeStyle = resolvedTheme.muted;
				ctx.globalAlpha = 0.22;
				ctx.lineWidth = 1;
				dividerRatios.forEach((ratio) => {
					const x = chartArea.left + (chartArea.width * ratio);
					if (!Number.isFinite(x)) return;
					ctx.beginPath();
					ctx.moveTo(x, chartArea.top);
					ctx.lineTo(x, chartArea.bottom);
					ctx.stroke();
				});
				ctx.restore();
			},
		};

		const oneDayCandlestickPlugin = {
			id: "oneDayCandlestickPlugin",
			afterDatasetsDraw(chartInstance) {
				if (!hasOneDayCandlesticks) return;
				const { ctx, chartArea, scales } = chartInstance;
				const yScale = scales?.y;
				if (!chartArea || !yScale) return;
				const datasetCount = Math.max(series.length, 1);
				const hairlineWidth = Math.max(0.35, 1 / Math.max(window.devicePixelRatio || 1, 1));
				const crossMarketWindowMinutes = Number.isFinite(crossMarketWindowStartBoundaryMinute) && Number.isFinite(crossMarketWindowEndBoundaryMinute)
					? crossMarketWindowEndBoundaryMinute - crossMarketWindowStartBoundaryMinute
					: 0;
				const sessionMinuteWidth = chartArea.width / (isCrossMarketOneDayRange && crossMarketWindowMinutes > 0
					? crossMarketWindowMinutes
					: oneDaySessionEndMinute - oneDaySessionStartMinute);
				const groupWidth = Math.max(1, Math.min(sessionMinuteWidth * 0.78, 8));
				const candleWidth = Math.max(hairlineWidth, groupWidth / datasetCount);
				ctx.save();
				series.forEach((item, datasetIndex) => {
					const candles = Array.isArray(item?.candlestick_returns) ? item.candlestick_returns : [];
					const strokeColor = item.color || resolvedTheme.accentPrimary || theme.accent_primary;
					const fillColor = hexToRgba(strokeColor, 0.28);
					const xOffset = (datasetIndex - ((datasetCount - 1) / 2)) * candleWidth;
					ctx.strokeStyle = strokeColor;
					ctx.fillStyle = fillColor;
					ctx.lineWidth = hairlineWidth;
					candles.forEach((candle, candleIndex) => {
						const high = toFiniteChartNumber(candle?.h);
						const low = toFiniteChartNumber(candle?.l);
						const open = toFiniteChartNumber(candle?.o);
						const close = toFiniteChartNumber(candle?.c);
						const volume = toFiniteChartNumber(candle?.v);
						if (candle?.synthetic === true) return;
						if (volume !== null && volume <= 0) return;
						if (![high, low, open, close].every((value) => value !== null)) return;
						const xRatio = getOneDayTimestampRatio(rawDates[candleIndex]);
						if (!Number.isFinite(xRatio)) return;
						const x = chartArea.left + (chartArea.width * xRatio) + xOffset;
						const highY = yScale.getPixelForValue(high);
						const lowY = yScale.getPixelForValue(low);
						const openY = yScale.getPixelForValue(open);
						const closeY = yScale.getPixelForValue(close);
						if (![x, highY, lowY, openY, closeY].every(Number.isFinite)) return;
						const bodyTop = Math.min(openY, closeY);
						const bodyHeight = Math.max(hairlineWidth, Math.abs(closeY - openY));
						const bodyLeft = x - (candleWidth / 2);
						ctx.beginPath();
						ctx.moveTo(x, highY);
						ctx.lineTo(x, lowY);
						ctx.stroke();
						ctx.fillRect(bodyLeft, bodyTop, candleWidth, bodyHeight);
						ctx.strokeRect(bodyLeft, bodyTop, candleWidth, bodyHeight);
					});
				});
				ctx.restore();
			},
		};

		const compareLiveMarkerPlugin = {
			id: "compareLiveMarkerPlugin",
			afterDatasetsDraw(chartInstance) {
				const liveCompareDate = String(chartState.liveComparison?.liveDate || "");
				const isLiveOneDayCompare = hasOneDayCandlesticks
					&& state.currentView === "tickers"
					&& selectedPeriod === "1d"
					&& chartState.liveComparison?.active === true
					&& liveCompareDate
					&& (!selectedTradingDateParam || selectedTradingDateParam === liveCompareDate);
				if (!isLiveOneDayCompare) {
					if (chartInstance.$compareLiveMarkerFrame) {
						window.cancelAnimationFrame(chartInstance.$compareLiveMarkerFrame);
						chartInstance.$compareLiveMarkerFrame = 0;
					}
					return;
				}
				const { ctx, chartArea, scales } = chartInstance;
				const yScale = scales?.y;
				if (!ctx || !chartArea || !yScale) return;
				const cycleMs = 1800;
				const phase = (performance.now() % cycleMs) / cycleMs;
				let drewMarker = false;
				const drawRing = (x, y, color, ringPhase, baseRadius, radiusRange, alpha) => {
					const radius = baseRadius + (radiusRange * ringPhase);
					ctx.beginPath();
					ctx.arc(x, y, radius, 0, Math.PI * 2);
					ctx.lineWidth = 1.6;
					ctx.strokeStyle = hexToRgba(color, alpha * (1 - ringPhase));
					ctx.stroke();
				};
				series.forEach((item, datasetIndex) => {
					const candles = Array.isArray(item?.candlestick_returns) ? item.candlestick_returns : [];
					let lastCandleIndex = candles.length - 1;
					while (lastCandleIndex >= 0) {
						const candidate = candles[lastCandleIndex];
						const volume = toFiniteChartNumber(candidate?.v);
						if (candidate?.synthetic !== true && (volume === null || volume > 0) && [candidate?.o, candidate?.h, candidate?.l, candidate?.c].every(isFiniteChartValue)) break;
						lastCandleIndex -= 1;
					}
					if (lastCandleIndex < 0) return;
					const xRatio = getOneDayTimestampRatio(rawDates[lastCandleIndex]);
					const close = toFiniteChartNumber(candles[lastCandleIndex]?.c);
					if (!Number.isFinite(xRatio) || close === null) return;
					const x = chartArea.left + (chartArea.width * xRatio);
					const y = yScale.getPixelForValue(close);
					if (![x, y].every(Number.isFinite)) return;
					if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) return;
					const color = String(item.color || chartInstance.data.datasets?.[datasetIndex]?.borderColor || resolvedTheme.accentPrimary || "#0055cc");
					const innerPhase = (phase + 0.5) % 1;
					ctx.save();
					drawRing(x, y, color, phase, 7, 13, 0.44);
					drawRing(x, y, color, innerPhase, 5, 9, 0.26);
					ctx.beginPath();
					ctx.arc(x, y, 3, 0, Math.PI * 2);
					ctx.fillStyle = color;
					ctx.shadowColor = hexToRgba(color, 0.42);
					ctx.shadowBlur = 10;
					ctx.fill();
					ctx.restore();
					drewMarker = true;
				});
				if (!drewMarker || chartInstance.$compareLiveMarkerFrame) return;
				chartInstance.$compareLiveMarkerFrame = window.requestAnimationFrame(() => {
					chartInstance.$compareLiveMarkerFrame = 0;
					if (!chartInstance.canvas?.isConnected) return;
					if (window.Chart?.getChart?.(chartInstance.canvas) !== chartInstance) return;
					chartInstance.draw();
				});
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
				const { ctx, chartArea, scales } = chartInstance;
				if (!chartArea) return;
				chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
					const profile = profiles.find((item) => item.ticker === dataset.label);
					if (!profile?.logo_url) return;
					const meta = chartInstance.getDatasetMeta(datasetIndex);
					const lastPoint = [...(meta?.data || [])]
						.reverse()
						.find((point) => !point?.skip && Number.isFinite(point?.y));
					if (!lastPoint) return;
					const image = getLogoImage(profile.logo_url, chartInstance);
					if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
					let centerX = chartArea.right + logoGap + (logoSize / 2);
					let centerY = lastPoint.y;
					if (hasOneDayCandlesticks) {
						const candles = Array.isArray(series[datasetIndex]?.candlestick_returns)
							? series[datasetIndex].candlestick_returns
							: [];
						let lastCandleIndex = candles.length - 1;
						while (lastCandleIndex >= 0) {
							const candidate = candles[lastCandleIndex];
							const volume = toFiniteChartNumber(candidate?.v);
							if (candidate?.synthetic !== true && (volume === null || volume > 0) && [candidate?.o, candidate?.h, candidate?.l, candidate?.c].every(isFiniteChartValue)) break;
							lastCandleIndex -= 1;
						}
						const lastRawDate = rawDates[lastCandleIndex];
						const lastCandle = candles[lastCandleIndex];
						const lastRatio = getOneDayTimestampRatio(lastRawDate);
						const close = toFiniteChartNumber(lastCandle?.c);
						if (Number.isFinite(lastRatio) && close !== null && scales?.y) {
							centerY = scales.y.getPixelForValue(close);
						}
					}
					const drawX = centerX - (logoSize / 2);
					const drawY = centerY - (logoSize / 2);

					ctx.save();
					drawStandardLogoBadge(ctx, drawX, drawY, logoSize);
					drawContainedImage(ctx, image, drawX, drawY, logoSize);
					ctx.restore();
				});
			},
		};

		const getOrCreateTooltip = (chart) => {
			const parent = chart.canvas.parentNode;
			let tooltip = parent.querySelector(".chart-tooltip");
			if (tooltip) return tooltip;
			tooltip = document.createElement("div");
			tooltip.className = "chart-tooltip";
			tooltip.innerHTML = '<div class="chart-tooltip-date"></div><div class="chart-tooltip-list"></div>';
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
				const crossMarketHtml = buildCrossMarketTooltipHtml(pointIndex);
				if (crossMarketHtml) {
					dateEl.innerHTML = crossMarketHtml;
				} else {
					dateEl.textContent = parsedDate ? formatChartDate(parsedDate) : (tooltip.title?.[0] || "");
				}
			}

			const bodyLines = tooltip.dataPoints.map((point) => {
				const profile = profiles.find((item) => item.ticker === point.dataset.label);
				return {
					color: point.dataset.borderColor,
					label: state.currentView === "portfolio" ? (portfolioLabelMap[point.dataset.label] || point.dataset.label) : point.dataset.label,
					logoUrl: profile?.logo_url || "",
					value: isMarketCapView ? formatMarketCapLabel(point.parsed.y) : formatPercentTooltipLabel(point.parsed.y),
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

		const referenceLineWidth = 1.5;
		const referenceShadowBlur = 0;

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
			shadowBlur: referenceShadowBlur,
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

		const formatChartDate = (dateParts) => (
			typeof formatFullDateParts === "function"
				? formatFullDateParts(dateParts, {
					includeTime: Number.isFinite(dateParts?.hours)
						&& Number.isFinite(dateParts?.minutes)
						&& (dateParts.hours !== 0 || dateParts.minutes !== 0),
				})
				: `${dateParts.day}/${dateParts.monthIndex + 1}/${dateParts.year}`
		);

		const formatChartDateLines = (dateParts) => (
			typeof formatFullDateLines === "function"
				? formatFullDateLines(dateParts, { allowWrap: true })
				: [`${dateParts.day}/${dateParts.monthIndex + 1}`, `${dateParts.year}`]
		);

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

		const buildChartTickIndexes = (chartLabels, chartRawDates, plotWidth, useIntradayDedup = false) => {
			const tickIndexes = Array.from(buildTickIndexSet(chartLabels.length, plotWidth)).sort((left, right) => left - right);
			if (!useIntradayDedup) return tickIndexes;
			const uniqueDays = new Set(chartRawDates.map((value) => normalizeDateKey(value)).filter(Boolean));
			if (uniqueDays.size <= 1) return tickIndexes;
			const seenDays = new Set();
			return tickIndexes.filter((index) => {
				const dayKey = normalizeDateKey(chartRawDates[index]);
				if (!dayKey || seenDays.has(dayKey)) return false;
				seenDays.add(dayKey);
				return true;
			});
		};

		const targetSeriesByIndex = series.map((item) => (
			isMarketCapView ? (item.market_caps || []) : item.normalized_returns
		));
		const candlestickSeriesByIndex = series.map((item) => (
			Array.isArray(item?.candlestick_returns)
				? item.candlestick_returns.flatMap((candle) => [candle?.o, candle?.h, candle?.l, candle?.c])
				: []
		));
		const shouldAnimateRefreshTransition = Boolean(refreshTransition) && !hasIntradayLabels;
		const chartYScale = buildPixelPaddedYScale(
			canvas,
			hasOneDayCandlesticks ? candlestickSeriesByIndex : targetSeriesByIndex,
			chartYPaddingPx,
		);
		const axisFontSize = readPxToken(canvas, "--workspace-share-chart-axis-font-size", 12);
		const xAxisBottomPadding = isCompareOneDayRange || isCompareShortMultiDayRange
			? Math.max(30, Math.round(axisFontSize * 3.1))
			: Math.max(22, Math.round(axisFontSize * 2.6));
		const chart = new Chart(canvas, {
			type: "line",
			data: {
				labels,
				datasets: series.map((item, index) => {
					const strokeColor = item.color || resolvedTheme.accentPrimary || theme.accent_primary;
					return {
						...baseDatasetStyle,
						label: item.ticker,
						data: refreshTransition
							? buildAlignedSeries(
								previousSeriesMap.get(item.ticker)?.dates || refreshTransition.labels,
								previousSeriesMap.get(item.ticker)?.values || [],
								labels,
								isMarketCapView ? (item.market_caps || []) : item.normalized_returns,
							)
							: (isMarketCapView ? (item.market_caps || []) : item.normalized_returns),
						borderColor: strokeColor,
						pointHoverBackgroundColor: strokeColor,
						shadowColor: hexToRgba(strokeColor, 0.4),
						glow: item.glow !== false,
						shadowBlur: referenceShadowBlur,
						showLine: !hasOneDayCandlesticks,
						segment: {
							borderColor: (context) => {
								if (!hasIntradayLabels) return strokeColor;
								const leftIndex = Number(context?.p0DataIndex);
								const rightIndex = Number(context?.p1DataIndex);
								const leftDate = normalizeDateKey(rawDates[leftIndex]);
								const rightDate = normalizeDateKey(rawDates[rightIndex]);
								if (leftDate && rightDate && leftDate !== rightDate) return "rgba(0, 85, 204, 0)";
								const leftSerialMinute = getRawDateSerialMinute(rawDates[leftIndex]);
								const rightSerialMinute = getRawDateSerialMinute(rawDates[rightIndex]);
								if (
									Number.isFinite(leftSerialMinute)
									&& Number.isFinite(rightSerialMinute)
									&& Math.abs(rightSerialMinute - leftSerialMinute) > MAX_INTRADAY_CONNECTED_GAP_MINUTES
								) {
									return "rgba(0, 85, 204, 0)";
								}
								return strokeColor;
							},
						},
					};
				}),
			},
			options: {
				animation: hasIntradayLabels || shouldAnimateRefreshTransition ? false : undefined,
				responsive: true,
				maintainAspectRatio: false,
				layout: { padding: { top: 8, right: logoSize + logoGap + logoRightPadding, bottom: xAxisBottomPadding, left: 4 } },
				interaction: { mode: "index", intersect: false },
				hover: { mode: "index", intersect: false },
				onHover(_event, activeElements, chartInstance) {
					const activeIndexes = new Set(activeElements.map((item) => item.datasetIndex));
					chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
						if (activeIndexes.size === 0) {
							dataset.borderWidth = referenceLineWidth;
							dataset.shadowBlur = referenceShadowBlur;
						} else if (activeIndexes.has(datasetIndex)) {
							dataset.borderWidth = referenceLineWidth;
							dataset.shadowBlur = referenceShadowBlur;
						} else {
							dataset.borderWidth = referenceLineWidth;
							dataset.shadowBlur = referenceShadowBlur;
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
							font: {
								family: 'GDS Transport, Helvetica Neue, Arial, sans-serif',
								size: readPxToken(canvas, '--workspace-share-chart-axis-font-size', 12),
							},
							callback(value, index, ticks) {
								if (index === 0 || index === ticks.length - 1) return "";
								return isMarketCapView ? formatMarketCapLabel(value, 1) : formatPercentAxisLabel(value);
							},
						},
					},
				},
			},
			plugins: [glowPlugin, zeroBandPlugin, multiDaySessionGuidePlugin, oneDaySessionGuidePlugin, oneDayCandlestickPlugin, hoverGuidePlugin, compareLiveMarkerPlugin, lineEndLogoPlugin, xAxisLabelPlugin],
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
		if (shouldAnimateRefreshTransition) {
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
		if (state.currentView === "tickers" || state.currentView === "portfolio") {
			bootstrap.workspaceShare?.dispatchReady?.(state.currentView);
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
