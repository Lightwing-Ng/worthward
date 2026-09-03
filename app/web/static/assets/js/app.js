/* Code version: v0.51.0 */
(() => {
    const state = window.WORTHWARD_APP;
    if (!state) return;
    const preferenceStorage = window.WORTHWARD_STORAGE || {
        local: window.localStorage,
        session: window.sessionStorage,
    };
    const normalizeComparisonMetric = (value) => (
        String(value || "").trim().toLowerCase() === "market-cap" ? "market-cap" : "price"
    );
    const isMarketCapComparison = () => (
        state.currentView === "prices" && normalizeComparisonMetric(state.comparisonMetric) === "market-cap"
    );
    const responsive = window.WORTHWARD_RESPONSIVE;
    const bootstrap = window.WORTHWARD_BOOTSTRAP = window.WORTHWARD_BOOTSTRAP || {};
    const fetchAbortDebugConfig = state.debug?.fetchAbort || null;
    const reportFetchAbortDebug = (hypothesisId, location, msg, data = {}, runId = "post-fix") => {
        // #region debug-point A:frontend-fetch-abort
        if (!fetchAbortDebugConfig?.url) return;
        fetch(fetchAbortDebugConfig.url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                sessionId: fetchAbortDebugConfig.sessionId || "frontend-fetch-aborts",
                runId,
                hypothesisId,
                location,
                msg: `[DEBUG] ${msg}`,
                data,
                ts: Date.now(),
            }),
        }).catch(() => {});
        // #endregion
    };

    const {defaults, labels, endpoints, constraints, theme} = state;
    const workspaceUrlState = window.WORTHWARD_WORKSPACE_URL_STATE || null;
    const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const MONTH_TOKEN_TO_INDEX = MONTH_ABBREVIATIONS.reduce((accumulator, label, index) => {
        accumulator[label.toLowerCase()] = index;
        accumulator[MONTH_LABELS[index].toLowerCase()] = index;
        return accumulator;
    }, {});
    const THEME_MODE_STORAGE_KEY = "worthward:theme-mode";
    const isPortfolioView = state.currentView === "portfolio";
    const isBacktestView = state.currentView === "backtest";
    const isDcaView = state.currentView === "dca";
    const isDcaStrategy = isBacktestView && state.selectedStrategyId === "dca";
    const MIN_TICKERS = constraints?.minTickers || 2;
    const PRICE_COMPARISON_MAX_TICKERS = 5;
    let MAX_TICKERS = constraints?.maxTickers || PRICE_COMPARISON_MAX_TICKERS;
    const minimumRequiredTickers = (isBacktestView || isDcaView) ? 1 : MIN_TICKERS;
    const getMinimumRequiredTickers = () => {
        if (!isBacktestView) return minimumRequiredTickers;
        const configured = Number.parseInt(
            document.querySelector("form.controls")?.dataset.strategyRequiredTickers || "",
            10,
        );
        return Number.isFinite(configured) ? Math.max(1, configured) : minimumRequiredTickers;
    };
    const getLanguageState = () => window.WORTHWARD_APP?.language || {};
    const translateUi = (value) => {
        const languageState = getLanguageState();
        const languageCode = String(languageState.code || "en");
        if (languageCode === "en") return value;
        const row = Array.isArray(languageState.translations)
            ? languageState.translations.find((candidate) => candidate?.en === value)
            : null;
        return row?.[languageCode] || value;
    };
    const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
    const sanitizeTicker = (value) => value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 15);
    const tickerMatchKeys = (value) => {
        const ticker = sanitizeTicker(value || "");
        if (!ticker) return new Set();
        const keys = new Set([ticker]);
        const [symbolHead, suffix = ""] = ticker.split(".", 2);
        const numericHead = /^\d+$/.test(symbolHead) ? (symbolHead.replace(/^0+/, "") || "0") : "";
        if (numericHead) {
            keys.add(numericHead);
            if (suffix) keys.add(`${numericHead}.${suffix}`);
            if (suffix === "HK") keys.add(`${numericHead.padStart(4, "0")}.HK`);
            if (suffix === "KS") keys.add(`${numericHead.padStart(6, "0")}.KS`);
        }
        return keys;
    };
    const tickersEquivalent = (left, right) => {
        const leftTicker = sanitizeTicker(left || "");
        const rightTicker = sanitizeTicker(right || "");
        if (!leftTicker || !rightTicker) return false;
        if (leftTicker === rightTicker) return true;
        const [leftHead, leftSuffix = ""] = leftTicker.split(".", 2);
        const [rightHead, rightSuffix = ""] = rightTicker.split(".", 2);
        const normalizedLeftHead = /^\d+$/.test(leftHead) ? (leftHead.replace(/^0+/, "") || "0") : leftHead;
        const normalizedRightHead = /^\d+$/.test(rightHead) ? (rightHead.replace(/^0+/, "") || "0") : rightHead;
        if (leftSuffix && rightSuffix) {
            const shanghaiAliases = new Set(["SH", "SS"]);
            return normalizedLeftHead === normalizedRightHead
                && shanghaiAliases.has(leftSuffix)
                && shanghaiAliases.has(rightSuffix);
        }
        const leftKeys = tickerMatchKeys(left);
        const rightKeys = tickerMatchKeys(right);
        for (const key of leftKeys) {
            if (rightKeys.has(key)) return true;
        }
        return false;
    };
    const tickersExplicitlyEquivalent = (candidate, query) => {
        const normalizedCandidate = sanitizeTicker(candidate || "");
        const normalizedQuery = sanitizeTicker(query || "");
        if (!normalizedCandidate || !normalizedQuery) return false;
        if (normalizedCandidate === normalizedQuery) return true;
        if (/^\d+$/.test(normalizedQuery)) return false;
        return tickersEquivalent(normalizedCandidate, normalizedQuery);
    };
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => Array.from(document.querySelectorAll(selector));
    const setInlineStyleIfChanged = (element, propertyName, value) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.style.getPropertyValue(propertyName) === value) return false;
        element.style.setProperty(propertyName, value);
        return true;
    };
    const WORKSPACE_VIEWS = new Set(["tickers", "prices", "portfolio", "dca", "backtest"]);
    const UNKNOWN_MESSAGE = "Unknown or unsupported ticker.";
    const VIEW_MEMORY_KEY = "worthward:view-memory";
    const TRANSIENT_VIEW_QUERY_KEYS = new Set(["notice", "error", "broker_test_status", "broker_test_message", "broker_test_checked_at"]);
    const SIDEBAR_MEMORY_KEY = "worthward:sidebar-open";
    const TRADE_DETAIL_MEMORY_KEY = "worthward:trade-detail-tab";
    const STRATEGY_MEMORY_KEY = "worthward:recent-strategies";
    const BACKTEST_STRATEGY_PARAMS_MEMORY_KEY = "worthward:backtest-strategy-params:v1";
    let hasInitialResult = isBacktestView
        ? Boolean(isDcaStrategy ? state.dcaResult : state.backtestResult)
        : isDcaView
            ? Boolean(state.dcaResult)
            : Boolean(state.chart?.series?.length);
    let autoSubmitTimer = null;
    let dockFrame = null;
    let mobilePagePaddingFrame = 0;
    let mobilePagePaddingShouldPreserveBottom = false;
    let mobilePagePaddingObserver = null;
    let mobilePagePaddingScrollBound = false;
    let mobilePagePaddingScrollTarget = null;
    let isSubmittingWithOverlay = false;
    let compareOverlayTimer = null;
    let activeWorkspaceHydration = null;
    let activeWorkspaceSummaryMorphCleanup = null;
    let activeWorkspaceModeLayoutCleanup = null;
    let activeScrollableTableHeaderCleanup = null;
    let scheduleWorkspaceSummaryMorphSync = null;
    let workspaceHydrationToken = 0;
    let workspaceSubmitToken = 0;
    let lastWorkspaceRangeNoticeFingerprint = "";
    let lastWorkspaceRangeNoticeTexts = new Set();
    let pendingWorkspaceChartTransition = null;
    let optimisticNavigationFrame = 0;
    let optimisticNavigationSnapshot = null;
    const datePickerState = [];
    let datePickerDocumentListenersBound = false;
    let validTradingDateSet = null;
    let dateConstraintAvailability = {};
    let dateConstraintsRequestId = 0;
    let backtestIntervalRequestToken = 0;
    const portfolioWeightState = {
        clock: 0,
        touchedAtByIndex: {},
    };
    const tickerValidationCache = new Map();
    const workspaceModalOverlay = $("#workspace_modal_overlay");
    const workspaceModalOverlayClose = $("#workspace_modal_overlay_close");
    const workspaceModalOverlayTitle = workspaceModalOverlay?.querySelector(".workspace-modal-title");
    const workspaceModalOverlayCopy = workspaceModalOverlay?.querySelector(".workspace-modal-copy");
    const workspaceModalOverlayIcon = $("#workspace_modal_overlay_icon");
    const canTransitionDom = typeof document.startViewTransition === "function";
    const progressiveResourceCache = new Map();
    const localMarketPresenceRequestCache = new Map();
    const localMarketPresencePendingRequest = new Map();
    const progressiveViewRegistry = {
        tickers: {
            masks: [
                '[data-workspace-mask="compare-return"]',
                '[data-workspace-mask="compare-ttm-dividend-yield"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        prices: {
            masks: [
                '[data-workspace-mask="price-subplots"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        portfolio: {
            masks: [
                '[data-workspace-mask="portfolio-total-return"]',
                '[data-workspace-mask="portfolio-donut-start"]',
                '[data-workspace-mask="portfolio-donut-end"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        dca: {
            masks: [
                '[data-workspace-mask="trade-metric"]',
                '[data-workspace-mask="trade-price-chart"]',
                '[data-workspace-mask="trade-equity-chart"]',
            ],
        },
        "backtest": {
            masks: [
                '[data-workspace-mask="trade-metric"]',
                '[data-workspace-mask="trade-price-chart"]',
                '[data-workspace-mask="trade-equity-chart"]',
            ],
        },
        settings: {
            about: {masks: []},
            strategies: {masks: []},
            "email-smtp": {masks: []},
            network: {
                masks: [
                    '[data-workspace-mask="settings-status-icon"]',
                    '[data-workspace-mask="settings-status-text"]',
                ],
                hydrate: () => bootstrap.hydrateSettingsNetworkStatuses?.(),
            },
            "local-market-store": {
                masks: [
                    '[data-workspace-mask="local-store-date"]',
                ],
                hydrate: () => bootstrap.hydrateSettingsLocalStoreRanges?.(),
            },
        },
    };
    const CHART_CONTEXT_HOST_SELECTOR = [
        ".chart-wrap",
        ".trade-chart-canvas-wrap",
        ".investment-equity-chart-stage",
        ".investment-stock-details-price-chart-stage",
        ".live-trading-chart-shell",
        "[data-investment-stock-price-chart]",
        ".chart-surface",
    ].join(", ");
    const CHART_CONTEXT_MENU_ID = "chart_context_menu";
    let activeChartContextCanvas = null;

    const isExportableChartCanvas = (canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        if (canvas.width <= 0 || canvas.height <= 0) return false;
        return Boolean(window.Chart?.getChart?.(canvas));
    };

    const resolveChartCanvasFromTarget = (target) => {
        if (!(target instanceof Element)) return null;
        const directCanvas = target.closest("canvas");
        if (isExportableChartCanvas(directCanvas)) return directCanvas;
        const chartHost = target.closest(CHART_CONTEXT_HOST_SELECTOR);
        const hostedCanvas = chartHost?.querySelector?.("canvas");
        return isExportableChartCanvas(hostedCanvas) ? hostedCanvas : null;
    };

    const slugifyChartFilenamePart = (value) => {
        const normalized = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return normalized || "chart";
    };

    const buildChartSvgFilename = (canvas) => {
        const surface = canvas.closest(".chart-surface") || canvas.parentElement;
        const heading = surface?.querySelector?.(".chart-heading")?.textContent
            || canvas.getAttribute("aria-label")
            || document.title
            || "chart";
        const baseName = slugifyChartFilenamePart(heading);
        const idSuffix = slugifyChartFilenamePart(canvas.id || "");
        if (!idSuffix || idSuffix === "chart" || baseName.includes(idSuffix)) return `${baseName}.svg`;
        return `${baseName}-${idSuffix}.svg`;
    };

    const escapeSvgAttribute = (value) => String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const escapeSvgText = (value) => String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const readChartExportBackground = (canvas) => {
        const candidates = [
            canvas.closest(".chart-wrap, .trade-chart-canvas-wrap, .investment-equity-chart-stage, .investment-stock-details-price-chart-stage, .live-trading-chart-shell"),
            canvas.closest(".chart-surface"),
            document.body,
        ].filter(Boolean);
        for (const candidate of candidates) {
            const color = getComputedStyle(candidate).backgroundColor;
            if (color && color !== "transparent" && !/rgba\([^,]+,[^,]+,[^,]+,\s*0\s*\)/i.test(color)) {
                return color;
            }
        }
        return getComputedStyle(document.body).getPropertyValue("--theme-panel").trim() || "#ffffff";
    };

    const readChartFontFamily = (canvas) => {
        const computed = getComputedStyle(canvas);
        return computed.fontFamily || '"GDS Transport", "Helvetica Neue", Arial, sans-serif';
    };

    const readChartTickFontSize = (canvas, fallbackValue = 12) => {
        const raw = getComputedStyle(canvas).getPropertyValue("--workspace-share-chart-axis-font-size").trim();
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : fallbackValue;
    };

    const formatSvgNumber = (value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return "0";
        return String(Math.round(numeric * 1000) / 1000);
    };

    const formatSvgPercentLabel = (value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return "";
        return `${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
    };

    const normalizeSvgDateLabel = (value) => {
        const raw = String(value || "");
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
        if (!match) return raw;
        const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        const day = date.getUTCDate();
        const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
        const year = date.getUTCFullYear();
        if (match[4] && match[5] && (match[4] !== "00" || match[5] !== "00")) return `${match[4]}:${match[5]}\n${day} ${month} ${year}`;
        return `${day} ${month}\n${year}`;
    };

    const buildSvgLinePath = (points) => {
        const commands = [];
        let isOpen = false;
        points.forEach((point) => {
            const x = Number(point?.x);
            const y = Number(point?.y);
            const skipped = Boolean(point?.skip) || !Number.isFinite(x) || !Number.isFinite(y);
            if (skipped) {
                isOpen = false;
                return;
            }
            commands.push(`${isOpen ? "L" : "M"} ${formatSvgNumber(x)} ${formatSvgNumber(y)}`);
            isOpen = true;
        });
        return commands.join(" ");
    };

    const toFiniteSvgNumber = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const getSvgRawDateMinuteOfDay = (value) => {
        const match = String(value || "").match(/(?:[T ](\d{2}):(\d{2}))$/);
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        return (hours * 60) + minutes;
    };

    const getSvgRawDateSerialMinute = (value) => {
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

    const resolveSvgMarketTimeConfig = (ticker) => {
        const normalized = String(ticker || "").toUpperCase();
        const configs = [
            {suffixes: [".KS", ".KQ"], timezone: "Asia/Seoul", session: {open: 9 * 60, close: (15 * 60) + 31}},
            {suffixes: [".HK"], timezone: "Asia/Hong_Kong", session: {open: (9 * 60) + 30, close: 16 * 60}},
            {suffixes: [".T", ".JP"], timezone: "Asia/Tokyo", session: {open: 9 * 60, close: (15 * 60) + 31}},
            {suffixes: [".SH", ".SS", ".SZ"], timezone: "Asia/Shanghai", session: {open: (9 * 60) + 30, close: 15 * 60}},
            {suffixes: [".SG", ".SI"], timezone: "Asia/Singapore", session: {open: 9 * 60, close: 17 * 60}},
            {suffixes: [".L"], timezone: "Europe/London", session: {open: 8 * 60, close: (16 * 60) + 30}},
            {suffixes: [".AX"], timezone: "Australia/Sydney", session: {open: 10 * 60, close: 16 * 60}},
            {suffixes: [".TO", ".V", ".NE", ".CN", ".CA"], timezone: "America/Toronto", session: {open: (9 * 60) + 30, close: 16 * 60}},
            {suffixes: [".PA", ".AS", ".BR", ".MI", ".MC", ".DE", ".F", ".HM", ".BE", ".DU", ".MU", ".HA", ".SW", ".VI", ".ST", ".CO", ".OL", ".IR", ".IS"], timezone: "Europe/Paris", session: {open: 9 * 60, close: (17 * 60) + 30}},
            {suffixes: [".HE"], timezone: "Europe/Helsinki", session: {open: 9 * 60, close: (17 * 60) + 30}},
            {suffixes: [".NS", ".BO"], timezone: "Asia/Kolkata", session: {open: (9 * 60) + 15, close: (15 * 60) + 30}},
            {suffixes: [".TW", ".TWO"], timezone: "Asia/Taipei", session: {open: 9 * 60, close: (13 * 60) + 30}},
            {suffixes: [".KL"], timezone: "Asia/Kuala_Lumpur", session: {open: 9 * 60, close: 17 * 60}},
            {suffixes: [".BK"], timezone: "Asia/Bangkok", session: {open: 10 * 60, close: (16 * 60) + 30}},
            {suffixes: [".JK"], timezone: "Asia/Jakarta", session: {open: 9 * 60, close: 16 * 60}},
            {suffixes: [".NZ"], timezone: "Pacific/Auckland", session: {open: 10 * 60, close: (16 * 60) + 45}},
            {suffixes: [".SA"], timezone: "America/Sao_Paulo", session: {open: 10 * 60, close: 17 * 60}},
            {suffixes: [".BA", ".MX"], timezone: "America/Mexico_City", session: {open: (8 * 60) + 30, close: 15 * 60}},
            {suffixes: [".TA"], timezone: "Asia/Jerusalem", session: {open: (9 * 60) + 30, close: (17 * 60) + 30}},
            {suffixes: [".SR", ".SE"], timezone: "Asia/Riyadh", session: {open: 10 * 60, close: 15 * 60}},
            {suffixes: [".JO"], timezone: "Africa/Johannesburg", session: {open: 9 * 60, close: 17 * 60}},
            {suffixes: [".QA"], timezone: "Asia/Qatar", session: {open: (9 * 60) + 30, close: (13 * 60) + 10}},
        ];
        const match = configs.find((config) => config.suffixes.some((suffix) => normalized.endsWith(suffix)));
        if (match) return match;
        return { timezone: "America/New_York", session: { open: (9 * 60) + 30, close: 16 * 60 } };
    };

    const getSvgTimezoneOffsetMinutes = (timezone, utcMs) => {
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

    const localSvgMarketMinuteToNewYorkSerialMinute = (dateText, marketMinute, config) => {
        if (!dateText || !config || !Number.isFinite(marketMinute)) return null;
        const match = String(dateText).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (![year, month, day].every(Number.isFinite)) return null;
        const localWallUtcMs = Date.UTC(year, month - 1, day, Math.floor(marketMinute / 60), marketMinute % 60);
        const marketOffset = getSvgTimezoneOffsetMinutes(config.timezone, localWallUtcMs);
        const actualUtcMs = localWallUtcMs - (marketOffset * 60000);
        const newYorkOffset = getSvgTimezoneOffsetMinutes("America/New_York", actualUtcMs);
        const newYorkWallMs = actualUtcMs + (newYorkOffset * 60000);
        return Math.round(newYorkWallMs / 60000);
    };

    const buildSvgOneDayTimestampRatio = (sourceSeries, rawDates) => {
        const hasCrossMarketRange = sourceSeries.some((item) => /\.(AS|AX|BA|BE|BK|BO|BR|CA|CN|CO|DE|DU|F|HA|HE|HK|HM|IR|IS|JK|JP|KL|KQ|KS|L|MC|MI|MX|NE|NS|NZ|OL|PA|QA|SA|SE|SG|SH|SI|SR|SS|ST|SW|SZ|TA|T|TO|TWO|TW|V|VI)$/i.test(String(item?.ticker || "")));
        if (hasCrossMarketRange) {
            const selectedTradingDate = String(state.chart?.tradingDate || rawDates.find(Boolean) || "");
            const sessionWindows = sourceSeries.flatMap((item) => {
                const config = resolveSvgMarketTimeConfig(item?.ticker);
                const openMinute = localSvgMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.session?.open, config);
                const closeBoundaryMinute = localSvgMarketMinuteToNewYorkSerialMinute(selectedTradingDate, config?.session?.close, config);
                if (!Number.isFinite(openMinute) || !Number.isFinite(closeBoundaryMinute)) return [];
                return [{
                    startBoundary: openMinute - 0.5,
                    closeBoundary: closeBoundaryMinute - 0.5,
                }];
            });
            if (sessionWindows.length) {
                const startBoundary = Math.min(...sessionWindows.map((item) => item.startBoundary));
                const endBoundary = Math.max(...sessionWindows.map((item) => item.closeBoundary));
                const totalMinutes = endBoundary - startBoundary;
                if (totalMinutes > 0) {
                    return (value) => {
                        const serialMinute = getSvgRawDateSerialMinute(value);
                        if (!Number.isFinite(serialMinute)) return null;
                        return Math.min(1, Math.max(0, (serialMinute - startBoundary) / totalMinutes));
                    };
                }
            }
        }

        const hasExtendedHours = rawDates.some((value) => {
            const minuteOfDay = getSvgRawDateMinuteOfDay(value);
            return Number.isFinite(minuteOfDay) && (minuteOfDay < ((9 * 60) + 30) || minuteOfDay >= (16 * 60));
        });
        const sessionStart = hasExtendedHours ? (4 * 60) : ((9 * 60) + 30);
        const sessionEnd = hasExtendedHours ? (20 * 60) : (16 * 60);
        const totalSessionMinutes = sessionEnd - sessionStart;
        return (value) => {
            const minuteOfDay = getSvgRawDateMinuteOfDay(value);
            if (!Number.isFinite(minuteOfDay) || totalSessionMinutes <= 0) return null;
            return Math.min(1, Math.max(0, (minuteOfDay - sessionStart) / totalSessionMinutes));
        };
    };

    const buildSvgCandlestickMarkup = ({ chart, chartArea, yScale, textColor }) => {
        const sourceSeries = Array.isArray(state.chart?.series) ? state.chart.series : [];
        const labels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
        const rawDates = Array.isArray(sourceSeries[0]?.raw_dates) ? sourceSeries[0].raw_dates : [];
        const hasCandles = labels.length > 0
            && rawDates.length === labels.length
            && sourceSeries.length === chart.data.datasets.length
            && sourceSeries.every((item) => Array.isArray(item?.candlestick_returns) && item.candlestick_returns.length === labels.length);
        if (!hasCandles) return "";

        const timestampRatio = buildSvgOneDayTimestampRatio(sourceSeries, rawDates);
        const datasetCount = Math.max(sourceSeries.length, 1);
        const hasExtendedHours = rawDates.some((value) => {
            const minuteOfDay = getSvgRawDateMinuteOfDay(value);
            return Number.isFinite(minuteOfDay) && (minuteOfDay < ((9 * 60) + 30) || minuteOfDay >= (16 * 60));
        });
        const sessionStart = hasExtendedHours ? (4 * 60) : ((9 * 60) + 30);
        const sessionEnd = hasExtendedHours ? (20 * 60) : (16 * 60);
        const sessionMinuteWidth = (chartArea.right - chartArea.left) / Math.max(1, sessionEnd - sessionStart);
        const groupWidth = Math.max(1, Math.min(sessionMinuteWidth * 0.78, 8));
        const candleWidth = Math.max(0.55, groupWidth / datasetCount);
        return sourceSeries.map((item, datasetIndex) => {
            const dataset = chart.data.datasets[datasetIndex] || {};
            const strokeColor = dataset.borderColor || item.color || textColor;
            const xOffset = (datasetIndex - ((datasetCount - 1) / 2)) * candleWidth;
            const candleMarkup = item.candlestick_returns.map((candle, candleIndex) => {
                const high = toFiniteSvgNumber(candle?.h);
                const low = toFiniteSvgNumber(candle?.l);
                const open = toFiniteSvgNumber(candle?.o);
                const close = toFiniteSvgNumber(candle?.c);
                const volume = toFiniteSvgNumber(candle?.v);
                if (candle?.synthetic === true) return "";
                if (volume !== null && volume <= 0) return "";
                if (![high, low, open, close].every((value) => value !== null)) return "";
                const xRatio = timestampRatio(rawDates[candleIndex]);
                if (!Number.isFinite(xRatio)) return "";
                const x = chartArea.left + ((chartArea.right - chartArea.left) * xRatio) + xOffset;
                const highY = yScale.getPixelForValue(high);
                const lowY = yScale.getPixelForValue(low);
                const openY = yScale.getPixelForValue(open);
                const closeY = yScale.getPixelForValue(close);
                if (![x, highY, lowY, openY, closeY].every(Number.isFinite)) return "";
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(0.55, Math.abs(closeY - openY));
                const bodyLeft = x - (candleWidth / 2);
                return [
                    `<line class="candle-wick" x1="${formatSvgNumber(x)}" y1="${formatSvgNumber(highY)}" x2="${formatSvgNumber(x)}" y2="${formatSvgNumber(lowY)}"/>`,
                    `<rect class="candle-body" x="${formatSvgNumber(bodyLeft)}" y="${formatSvgNumber(bodyTop)}" width="${formatSvgNumber(candleWidth)}" height="${formatSvgNumber(bodyHeight)}"/>`,
                ].join("");
            }).join("");
            if (!candleMarkup) return "";
            return [
                `<g class="candlestick-series" data-series="${escapeSvgAttribute(item.ticker || dataset.label || `series-${datasetIndex + 1}`)}" stroke="${escapeSvgAttribute(strokeColor)}" fill="${escapeSvgAttribute(strokeColor)}" fill-opacity="0.28" stroke-width="0.55">`,
                candleMarkup,
                "</g>",
            ].join("");
        }).join("");
    };

    const buildSvgTextLines = ({ text, x, y, lineHeight, anchor = "middle", className = "", fill = "currentColor" }) => {
        const lines = String(text || "").split("\n").filter((line) => line !== "");
        if (!lines.length) return "";
        const classAttr = className ? ` class="${escapeSvgAttribute(className)}"` : "";
        return [
            `<text${classAttr} x="${formatSvgNumber(x)}" y="${formatSvgNumber(y)}" text-anchor="${anchor}" fill="${escapeSvgAttribute(fill)}">`,
            ...lines.map((line, index) => (
                `<tspan x="${formatSvgNumber(x)}" dy="${index === 0 ? 0 : formatSvgNumber(lineHeight)}">${escapeSvgText(line)}</tspan>`
            )),
            "</text>",
        ].join("");
    };

    const buildVectorChartSvgMarkup = (canvas, chart) => {
        const rect = canvas.getBoundingClientRect();
        const displayWidth = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width));
        const displayHeight = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height));
        const background = readChartExportBackground(canvas);
        const chartArea = chart.chartArea;
        const yScale = chart.scales?.y;
        const xScale = chart.scales?.x;
        if (!chartArea || !yScale || !xScale) throw new Error("Chart scales are not available for vector export.");

        const computed = getComputedStyle(document.body);
        const mutedColor = computed.getPropertyValue("--theme-muted").trim() || "#5f6b7a";
        const textColor = computed.getPropertyValue("--theme-text").trim() || "#111111";
        const zeroColor = computed.getPropertyValue("--theme-muted").trim() || "#8a94a3";
        const fontFamily = readChartFontFamily(canvas);
        const axisFontSize = readChartTickFontSize(canvas);
        const lineHeight = Math.round(axisFontSize * 1.08);
        const labels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
        const labelIndexes = labels.length <= 1
            ? labels.map((_label, index) => index)
            : Array.from(new Set([
                0,
                Math.round((labels.length - 1) / (displayWidth >= 768 ? 3 : 2)),
                ...(displayWidth >= 768 ? [Math.round(((labels.length - 1) * 2) / 3)] : []),
                labels.length - 1,
            ])).sort((left, right) => left - right);

        const yTicks = Array.isArray(yScale.ticks) ? yScale.ticks : [];
        const seriesLabels = [];
        const candlestickMarkup = buildSvgCandlestickMarkup({ chart, chartArea, yScale, textColor });
        const datasetMarkup = candlestickMarkup || chart.data.datasets.map((dataset, datasetIndex) => {
            const meta = chart.getDatasetMeta(datasetIndex);
            if (meta.hidden || dataset.hidden) return "";
            const pathData = buildSvgLinePath(meta.data || []);
            if (!pathData) return "";
            const color = dataset.borderColor || dataset.backgroundColor || textColor;
            const lineWidth = Number(dataset.borderWidth || 1.5);
            const lastPoint = [...(meta.data || [])].reverse().find((point) => !point?.skip && Number.isFinite(point?.x) && Number.isFinite(point?.y));
            if (dataset.label) {
                seriesLabels.push(buildSvgTextLines({
                    text: dataset.label,
                    x: Math.min(displayWidth - 2, Number(lastPoint?.x || chartArea.right) + 14),
                    y: Number(lastPoint?.y || chartArea.top) + 4,
                    lineHeight,
                    anchor: "start",
                    className: "series-label",
                    fill: color,
                }));
            }
            return [
                `<g class="series" data-series="${escapeSvgAttribute(dataset.label || `series-${datasetIndex + 1}`)}">`,
                `<path class="series-line" d="${pathData}" fill="none" stroke="${escapeSvgAttribute(color)}" stroke-width="${formatSvgNumber(lineWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`,
                "</g>",
            ].join("");
        }).join("");

        const yTickMarkup = yTicks.map((tick, index) => {
            if (index === 0 || index === yTicks.length - 1) return "";
            const y = yScale.getPixelForValue(tick.value);
            if (!Number.isFinite(y)) return "";
            return buildSvgTextLines({
                text: formatSvgPercentLabel(tick.value),
                x: chartArea.left - 10,
                y: y + (axisFontSize * 0.35),
                lineHeight,
                anchor: "end",
                className: "axis-label y-axis-label",
                fill: mutedColor,
            });
        }).join("");

        const xTickMarkup = labelIndexes.map((index, tickIndex) => {
            const x = xScale.getPixelForValue(index);
            if (!Number.isFinite(x)) return "";
            let anchor = "middle";
            if (tickIndex === 0) anchor = "start";
            else if (tickIndex === labelIndexes.length - 1) anchor = "end";
            return buildSvgTextLines({
                text: normalizeSvgDateLabel(labels[index]),
                x,
                y: chartArea.bottom + axisFontSize + 4,
                lineHeight,
                anchor,
                className: "axis-label x-axis-label",
                fill: mutedColor,
            });
        }).join("");

        const zeroY = yScale.getPixelForValue(0);
        const zeroLineMarkup = Number.isFinite(zeroY) && zeroY >= chartArea.top && zeroY <= chartArea.bottom
            ? `<path class="zero-line" d="M ${formatSvgNumber(chartArea.left + 8)} ${formatSvgNumber(zeroY)} L ${formatSvgNumber(chartArea.right - 8)} ${formatSvgNumber(zeroY)}" fill="none" stroke="${escapeSvgAttribute(zeroColor)}" stroke-width="1"/>`
            : "";

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${displayWidth} ${displayHeight}" role="img">`,
            "<title>Editable vector chart export</title>",
            "<desc>Chart geometry exported as SVG paths and text from Chart.js data, without embedding a raster screenshot.</desc>",
            `<style>text{font-family:${escapeSvgText(fontFamily)};font-size:${formatSvgNumber(axisFontSize)}px;font-weight:400}.series-label{font-size:${formatSvgNumber(Math.max(9, axisFontSize * 0.86))}px;font-weight:500}</style>`,
            `<rect width="${displayWidth}" height="${displayHeight}" fill="${escapeSvgAttribute(background)}"/>`,
            `<clipPath id="chart-plot-clip"><rect x="${formatSvgNumber(chartArea.left)}" y="${formatSvgNumber(chartArea.top)}" width="${formatSvgNumber(chartArea.right - chartArea.left)}" height="${formatSvgNumber(chartArea.bottom - chartArea.top)}"/></clipPath>`,
            `<g class="axis y-axis">${yTickMarkup}</g>`,
            `<g class="axis x-axis">${xTickMarkup}</g>`,
            `<g class="plot-guides">${zeroLineMarkup}</g>`,
            `<g class="plot-series" clip-path="url(#chart-plot-clip)">${datasetMarkup}</g>`,
            `<g class="series-labels">${seriesLabels.join("")}</g>`,
            "</svg>",
        ].join("");
    };

    const buildChartSvgMarkup = (canvas) => {
        const chart = window.Chart?.getChart?.(canvas);
        if (!chart) throw new Error("Only Chart.js canvases can be exported as editable SVG.");
        return buildVectorChartSvgMarkup(canvas, chart);
    };

    const downloadBlobFile = (filename, blob) => {
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const closeChartContextMenu = () => {
        const menu = document.getElementById(CHART_CONTEXT_MENU_ID);
        if (menu) {
            menu.hidden = true;
            menu.classList.remove("is-open");
        }
        activeChartContextCanvas = null;
    };

    const downloadActiveChartSvg = () => {
        const canvas = activeChartContextCanvas;
        closeChartContextMenu();
        if (!isExportableChartCanvas(canvas)) return;
        try {
            const svg = buildChartSvgMarkup(canvas);
            downloadBlobFile(
                buildChartSvgFilename(canvas),
                new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
            );
        } catch (_error) {
            window.alert("SVG export failed. The chart contains an image that this browser cannot export.");
        }
    };

    const ensureChartContextMenu = () => {
        let menu = document.getElementById(CHART_CONTEXT_MENU_ID);
        if (menu) return menu;
        menu = document.createElement("div");
        menu.id = CHART_CONTEXT_MENU_ID;
        menu.className = "chart-context-menu";
        menu.setAttribute("role", "menu");
        menu.hidden = true;
        menu.innerHTML = `
            <button type="button" class="chart-context-menu-item" role="menuitem" data-chart-context-action="download-svg">
                <span class="icon chart-context-menu-icon" style="-webkit-mask-image: url(/static/images/tray.and.arrow.down.fill.svg); mask-image: url(/static/images/tray.and.arrow.down.fill.svg);" aria-hidden="true"></span>
                <span>Download SVG</span>
            </button>
        `;
        menu.addEventListener("click", (event) => {
            const action = event.target instanceof Element
                ? event.target.closest("[data-chart-context-action]")?.dataset.chartContextAction
                : "";
            if (action === "download-svg") downloadActiveChartSvg();
        });
        document.body.appendChild(menu);
        return menu;
    };

    const positionChartContextMenu = (menu, clientX, clientY) => {
        menu.hidden = false;
        menu.classList.add("is-open");
        menu.style.left = "0px";
        menu.style.top = "0px";
        const rect = menu.getBoundingClientRect();
        const margin = 8;
        const left = Math.min(
            Math.max(margin, clientX),
            Math.max(margin, window.innerWidth - rect.width - margin),
        );
        const top = Math.min(
            Math.max(margin, clientY),
            Math.max(margin, window.innerHeight - rect.height - margin),
        );
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    };

    document.addEventListener("contextmenu", (event) => {
        const canvas = resolveChartCanvasFromTarget(event.target);
        if (!canvas) {
            closeChartContextMenu();
            return;
        }
        event.preventDefault();
        activeChartContextCanvas = canvas;
        positionChartContextMenu(ensureChartContextMenu(), event.clientX, event.clientY);
    });
    document.addEventListener("pointerdown", (event) => {
        const menu = document.getElementById(CHART_CONTEXT_MENU_ID);
        if (!menu || menu.hidden || menu.contains(event.target)) return;
        closeChartContextMenu();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeChartContextMenu();
    });
    window.addEventListener("resize", closeChartContextMenu);
    window.addEventListener("scroll", closeChartContextMenu, true);

    const getProgressiveManifest = (view, section = null) => {
        if (view === "settings") {
            return progressiveViewRegistry.settings[section || "about"] || {masks: []};
        }
        return progressiveViewRegistry[view] || {masks: []};
    };

    const resolveSettingsSectionFromUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            const pathMatch = parsedUrl.pathname.match(/^\/settings\/([^/?#]+)/);
            return pathMatch?.[1] || "about";
        } catch (_error) {
            return "about";
        }
    };

    const resolveTradeSectionFromUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            const pathMatch = parsedUrl.pathname.match(/^\/(?:trade|more)\/([^/?#]+)/);
            if (pathMatch?.[1] === "live-trading") return "live-trading";
            return "investment";
        } catch (_error) {
            return "investment";
        }
    };

    const SETTINGS_NAVIGATION_PROFILES = Object.freeze({
        about: {title: translateUi("About"), layout: "reading"},
        backtest: {title: translateUi("Backtest"), layout: "options"},
        "broker-access": {title: translateUi("Broker access"), layout: "broker"},
        "cash-equivalents": {title: translateUi("Cash equivalents"), layout: "actions"},
        "clear-caches": {title: translateUi("Clear caches"), layout: "actions"},
        "email-smtp": {title: translateUi("Email (SMTP)"), layout: "form"},
        "export-image": {title: translateUi("Export images"), layout: "tokens"},
        "font-tokens": {title: translateUi("Font tokens"), layout: "tokens"},
        "color-tokens": {title: translateUi("Color tokens"), layout: "tokens"},
        general: {title: translateUi("General"), layout: "options"},
        "local-market-store": {title: translateUi("Local market store"), layout: "table"},
        "material-tokens": {title: translateUi("Material tokens"), layout: "tokens"},
        network: {title: translateUi("Network self-check"), layout: "actions"},
        strategies: {title: translateUi("Strategies"), layout: "actions"},
        "style-tokens": {title: translateUi("Style tokens"), layout: "tokens"},
    });
    const SETTINGS_NAVIGATION_ORDER = Object.freeze(Object.keys(SETTINGS_NAVIGATION_PROFILES));
    const TRADE_NAVIGATION_PROFILES = Object.freeze({
        investment: {title: "Investment"},
        "live-trading": {title: "Live trading"},
    });
    const WORKSPACE_NAVIGATION_PROFILES = Object.freeze({
        tickers: {title: labels.dock_tickers || "Return comparison"},
        prices: {title: labels.dock_ticker_comparison || "Ticker comparison"},
        portfolio: {title: labels.dock_portfolio || "Compute your portfolio"},
        dca: {title: labels.dock_dca || "Dollar-cost averaging"},
        backtest: {title: labels.dock_backtest || "Backtest"},
    });

    const escapeSkeletonText = (value) => String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

    const navigationSkeletonLine = (width = "100%", className = "") => `
        <span class="navigation-skeleton-line${className ? ` ${className}` : ""}"
              style="--navigation-skeleton-width: ${width};"></span>
    `;

    const navigationSkeletonLines = (widths) => `
        <div class="navigation-skeleton-copy">
            ${widths.map((width) => navigationSkeletonLine(width)).join("")}
        </div>
    `;

    const buildNavigationSidebar = (targetView, targetSection) => {
        let title = "Workspaces";
        let items = Object.entries(WORKSPACE_NAVIGATION_PROFILES)
            .filter(([key]) => key !== "dca")
            .map(([key, profile]) => ({
                key,
                label: profile.title,
            }));
        let activeKey = targetView;
        if (targetView === "settings") {
            title = labels.settings_title || "Settings";
            items = SETTINGS_NAVIGATION_ORDER.map((key) => ({key, label: SETTINGS_NAVIGATION_PROFILES[key].title}));
            activeKey = SETTINGS_NAVIGATION_PROFILES[targetSection] ? targetSection : "about";
        } else if (targetView === "trade") {
            title = labels.dock_trade || "Trade";
            items = Object.entries(TRADE_NAVIGATION_PROFILES).map(([key, profile]) => ({key, label: profile.title}));
            activeKey = TRADE_NAVIGATION_PROFILES[targetSection] ? targetSection : "investment";
        }
        const activeIndex = Math.max(items.findIndex((item) => item.key === activeKey), 0);
        return `
            <section class="hero"><h1>${escapeSkeletonText(title)}</h1></section>
            <nav class="settings-nav navigation-skeleton-sidebar-nav"
                 style="--settings-active-index: ${activeIndex};"
                 aria-hidden="true">
                ${items.map((item) => `
                    <div class="settings-nav-item${item.key === activeKey ? " is-active" : ""}">
                        <span class="settings-nav-icon-shell navigation-skeleton-icon"></span>
                        <span class="settings-nav-label">${escapeSkeletonText(item.label)}</span>
                    </div>
                `).join("")}
            </nav>
        `;
    };

    const buildNavigationTitleCard = (title) => `
        <article class="report-card workspace-article-card workspace-summary-card navigation-skeleton-title-card">
            <div class="report-heading-row"><p class="report-heading">${escapeSkeletonText(title)}</p></div>
        </article>
    `;

    const buildWorkspaceNavigationSkeleton = (targetView) => {
        const profile = WORKSPACE_NAVIGATION_PROFILES[targetView] || WORKSPACE_NAVIGATION_PROFILES.backtest;
        if (targetView === "tickers" || targetView === "prices") {
            return `
                <section class="workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                    ${buildNavigationTitleCard(profile.title)}
                    <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-summary-grid">
                        ${["72%", "56%", "68%"].map((width) => `<div class="navigation-skeleton-metric">${navigationSkeletonLines([width, "42%"])}</div>`).join("")}
                    </article>
                    <article class="chart-surface navigation-skeleton-card navigation-skeleton-chart">${navigationSkeletonLines(["30%"])}</article>
                </section>
            `;
        }
        if (targetView === "portfolio") {
            return `
                <section class="workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                    ${buildNavigationTitleCard(profile.title)}
                    <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-portfolio">
                        <span class="navigation-skeleton-orbit"></span>
                        <span class="navigation-skeleton-orbit"></span>
                        ${navigationSkeletonLines(["46%", "62%"]) }
                    </article>
                    <article class="chart-surface navigation-skeleton-card navigation-skeleton-chart">${navigationSkeletonLines(["34%"])}</article>
                </section>
            `;
        }
        const metricCount = targetView === "dca" ? 9 : 10;
        return `
            <section class="workspace-mode-shell navigation-skeleton-page">
                ${buildNavigationTitleCard(profile.title)}
                <div class="workspace-mode-layout navigation-skeleton-workspace-layout">
                    <article class="chart-surface workspace-mode-controls-surface navigation-skeleton-card navigation-skeleton-controls">
                        ${navigationSkeletonLines(["42%", "100%", "72%", "100%", "56%", "100%"]) }
                    </article>
                    <article class="workspace-mode-main navigation-skeleton-results">
                        <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-metrics-grid">
                            ${Array.from({length: metricCount}, () => `<div class="navigation-skeleton-metric">${navigationSkeletonLines(["68%", "42%"])}</div>`).join("")}
                        </article>
                        <article class="chart-surface navigation-skeleton-card navigation-skeleton-chart">${navigationSkeletonLines(["36%"])}</article>
                    </article>
                </div>
            </section>
        `;
    };

    const buildTradeNavigationSkeleton = (targetSection) => {
        const section = TRADE_NAVIGATION_PROFILES[targetSection] ? targetSection : "investment";
        const title = TRADE_NAVIGATION_PROFILES[section].title;
        if (section === "live-trading") {
            return `
                <section class="workspace-header investment-workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                    ${buildNavigationTitleCard(title)}
                    <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-live-trading">
                        ${navigationSkeletonLines(["26%", "58%", "34%", "100%", "42%", "100%"]) }
                        <div class="navigation-skeleton-action-row">${navigationSkeletonLine("38%")} ${navigationSkeletonLine("28%")}</div>
                    </article>
                </section>
            `;
        }
        return `
            <section class="workspace-header investment-workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                ${buildNavigationTitleCard(title)}
                <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-investment">
                    <div class="navigation-skeleton-segments">${Array.from({length: 4}, () => navigationSkeletonLine("100%")).join("")}</div>
                    <div class="navigation-skeleton-chart navigation-skeleton-chart-compact"></div>
                </article>
                <article class="chart-surface navigation-skeleton-card navigation-skeleton-table">
                    ${navigationSkeletonLines(["28%", "100%", "100%", "92%", "100%", "84%"]) }
                </article>
            </section>
        `;
    };

    const buildSettingsNavigationContent = (layout) => {
        if (layout === "broker") {
            return `
                <section class="settings-action-package navigation-skeleton-card navigation-skeleton-callout">
                    <span class="navigation-skeleton-icon navigation-skeleton-icon-large"></span>
                    ${navigationSkeletonLines(["92%", "76%"]) }
                </section>
                <section class="settings-stack-form settings-form-shell navigation-skeleton-form">
                    ${["Broker", "Authentication", "Credential", "Account"].map((label) => `
                        <div class="navigation-skeleton-field">
                            <span class="settings-form-label">${label}</span>
                            ${navigationSkeletonLine("100%", "navigation-skeleton-control")}
                        </div>
                    `).join("")}
                    <section class="settings-action-package navigation-skeleton-card navigation-skeleton-form-action">
                        ${navigationSkeletonLines(["78%", "58%"]) }
                        ${navigationSkeletonLine("34%", "navigation-skeleton-button")}
                    </section>
                </section>
            `;
        }
        if (layout === "table") {
            return `<section class="navigation-skeleton-card navigation-skeleton-table">${navigationSkeletonLines(["100%", "96%", "100%", "90%", "100%", "94%", "100%"])}</section>`;
        }
        if (layout === "tokens") {
            return `<section class="navigation-skeleton-token-grid">${Array.from({length: 8}, (_, index) => `<article class="navigation-skeleton-card navigation-skeleton-token">${navigationSkeletonLines([index % 2 ? "54%" : "68%", "88%", "44%"])}</article>`).join("")}</section>`;
        }
        if (layout === "options") {
            return `<section class="navigation-skeleton-option-stack">${Array.from({length: 5}, () => `<article class="navigation-skeleton-card navigation-skeleton-option">${navigationSkeletonLines(["38%", "86%", "64%"])}</article>`).join("")}</section>`;
        }
        if (layout === "actions") {
            return `<section class="navigation-skeleton-option-stack">${Array.from({length: 4}, () => `<article class="settings-action-package navigation-skeleton-card navigation-skeleton-action">${navigationSkeletonLines(["46%", "92%", "70%"])}</article>`).join("")}</section>`;
        }
        if (layout === "form") {
            return `<section class="settings-stack-form settings-form-shell navigation-skeleton-form">${Array.from({length: 5}, () => `<div class="navigation-skeleton-field">${navigationSkeletonLine("32%")} ${navigationSkeletonLine("100%", "navigation-skeleton-control")}</div>`).join("")}</section>`;
        }
        return `<article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-reading">${navigationSkeletonLines(["38%", "96%", "88%", "92%", "74%", "86%"])}</article>`;
    };

    const buildSettingsNavigationSkeleton = (targetSection) => {
        const section = SETTINGS_NAVIGATION_PROFILES[targetSection] ? targetSection : "about";
        const profile = SETTINGS_NAVIGATION_PROFILES[section];
        return `
            <section class="workspace-header settings-workspace-header settings-shell-${section} navigation-skeleton-page"
                     id="settings_workspace_shell"
                     data-settings-workspace-region
                     data-settings-section="${section}">
                ${buildNavigationTitleCard(profile.title)}
                ${buildSettingsNavigationContent(profile.layout)}
            </section>
        `;
    };

    const renderOptimisticNavigationSkeleton = ({view, section = null} = {}) => {
        const targetView = view || state.currentView;
        const workspacePanel = document.getElementById("workspace_panel");
        const sidebar = document.getElementById("app_sidebar");
        if (!(workspacePanel instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return false;
        let normalizedSection = section;
        let workspaceMarkup = "";
        if (targetView === "settings") {
            normalizedSection = SETTINGS_NAVIGATION_PROFILES[section] ? section : "about";
            workspaceMarkup = buildSettingsNavigationSkeleton(normalizedSection);
        } else if (targetView === "trade") {
            normalizedSection = TRADE_NAVIGATION_PROFILES[section] ? section : "investment";
            workspaceMarkup = buildTradeNavigationSkeleton(normalizedSection);
        } else if (WORKSPACE_VIEWS.has(targetView)) {
            workspaceMarkup = buildWorkspaceNavigationSkeleton(targetView);
        } else {
            return false;
        }
        if (targetView !== state.currentView) {
            sidebar.innerHTML = buildNavigationSidebar(targetView, normalizedSection);
        }
        workspacePanel.innerHTML = `
            <div class="navigation-skeleton-status sr-only" role="status" aria-live="polite">Loading ${escapeSkeletonText(targetView === "settings" ? SETTINGS_NAVIGATION_PROFILES[normalizedSection].title : targetView === "trade" ? TRADE_NAVIGATION_PROFILES[normalizedSection].title : WORKSPACE_NAVIGATION_PROFILES[targetView].title)}</div>
            <div class="navigation-skeleton-root" data-navigation-skeleton aria-hidden="true">${workspaceMarkup}</div>
        `;
        workspacePanel.dataset.navigationSkeleton = "1";
        workspacePanel.setAttribute("aria-busy", "true");
        scheduleMobilePageBottomPaddingSync();
        return true;
    };
    const clearOptimisticNavigationSkeleton = () => {
        const workspacePanel = document.getElementById("workspace_panel");
        if (!(workspacePanel instanceof HTMLElement)) return;
        delete workspacePanel.dataset.navigationSkeleton;
        workspacePanel.removeAttribute("aria-busy");
    };
    const captureOptimisticNavigationSnapshot = () => {
        if (optimisticNavigationSnapshot) return;
        const sidebar = document.getElementById("app_sidebar");
        const workspacePanel = document.getElementById("workspace_panel");
        const dock = document.querySelector(".sidebar-dock");
        if (!(sidebar instanceof HTMLElement) || !(workspacePanel instanceof HTMLElement)) return;
        optimisticNavigationSnapshot = {
            sidebarNodes: Array.from(sidebar.childNodes),
            workspaceNodes: Array.from(workspacePanel.childNodes),
            dockState: Array.from(dock?.querySelectorAll(".sidebar-dock-item") || []).map((item) => ({
                className: item.className,
                ariaCurrent: item.getAttribute("aria-current"),
            })),
        };
    };
    const restoreOptimisticNavigationSnapshot = () => {
        if (!optimisticNavigationSnapshot) return false;
        const sidebar = document.getElementById("app_sidebar");
        const workspacePanel = document.getElementById("workspace_panel");
        const dock = document.querySelector(".sidebar-dock");
        if (!(sidebar instanceof HTMLElement) || !(workspacePanel instanceof HTMLElement)) return false;
        sidebar.replaceChildren(...optimisticNavigationSnapshot.sidebarNodes);
        workspacePanel.replaceChildren(...optimisticNavigationSnapshot.workspaceNodes);
        if (dock instanceof HTMLElement) {
            Array.from(dock.querySelectorAll(".sidebar-dock-item")).forEach((item, index) => {
                const itemState = optimisticNavigationSnapshot.dockState[index];
                if (!itemState) return;
                item.className = itemState.className;
                if (itemState.ariaCurrent) {
                    item.setAttribute("aria-current", itemState.ariaCurrent);
                } else {
                    item.removeAttribute("aria-current");
                }
            });
        }
        optimisticNavigationSnapshot = null;
        clearOptimisticNavigationSkeleton();
        scheduleDockPosition();
        scheduleMobilePageBottomPaddingSync();
        return true;
    };
    bootstrap.renderOptimisticNavigationSkeleton = renderOptimisticNavigationSkeleton;
    bootstrap.clearOptimisticNavigationSkeleton = clearOptimisticNavigationSkeleton;

    const resolveViewFromUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            const path = parsedUrl.pathname.toLowerCase();
            if (
                path === "/compare"
                || path.startsWith("/compare/")
                || path === "/workspaces/compare"
                || path.startsWith("/workspaces/compare/")
            ) return "tickers";
            if (path === "/workspaces/market-caps" || path.startsWith("/workspaces/market-caps/")) return "prices";
            if (path === "/workspaces/prices" || path.startsWith("/workspaces/prices/")) return "prices";
            if (
                path === "/portfolio"
                || path.startsWith("/portfolio/")
                || path === "/workspaces/portfolio"
                || path.startsWith("/workspaces/portfolio/")
            ) return "portfolio";
            if (
                path === "/dca"
                || path.startsWith("/dca/")
                || path === "/workspaces/dca"
                || path.startsWith("/workspaces/dca/")
            ) return "backtest";
            if (
                path === "/backtest"
                || path.startsWith("/backtest/")
                || path === "/workspaces/backtest"
                || path.startsWith("/workspaces/backtest/")
            ) return "backtest";
            if (path === "/trade" || path.startsWith("/trade/") || path === "/more" || path.startsWith("/more/") || path === "/invest" || path === "/investment") return "trade";
            if (path === "/settings" || path.startsWith("/settings/")) return "settings";
            return null;
        } catch (_error) {
            return null;
        }
    };

    const resolveDockGroupFromView = (view) => (WORKSPACE_VIEWS.has(view) ? "workspace" : view);

    const normalizeNavigationUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        } catch (_error) {
            return String(url || "");
        }
    };

    const syncDockPreviewTarget = (targetDockGroup) => {
        if (!targetDockGroup) return;
        const dockGroupByIndex = ["workspace", "trade", "settings"];
        $$(".sidebar-dock-item").forEach((link, index) => {
            const isTarget = dockGroupByIndex[index] === targetDockGroup;
            link.classList.toggle("is-active", isTarget);
            if (isTarget) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    };

    const syncLocalPreviewTarget = (link) => {
        if (!(link instanceof HTMLElement)) return;
        if (link.classList.contains("settings-nav-item")) {
            const nav = link.closest(".settings-nav, .settings-nav-list, .hero");
            const scope = nav || link.parentElement;
            const navItems = Array.from(scope?.querySelectorAll(".settings-nav-item") || []);
            let activeIndex = 0;
            navItems.forEach((item, index) => {
                const isTarget = item === link;
                item.classList.toggle("is-active", isTarget);
                if (isTarget) {
                    item.setAttribute("aria-current", "page");
                    activeIndex = index;
                } else {
                    item.removeAttribute("aria-current");
                }
            });
            if (scope instanceof HTMLElement) scope.style.setProperty("--settings-active-index", String(Math.max(0, activeIndex)));
            return;
        }
        if (link.classList.contains("local-store-page-button") && !link.classList.contains("local-store-page-nav")) {
            const pagination = link.closest(".local-store-pagination");
            pagination?.querySelectorAll(".local-store-page-button").forEach((item) => {
                item.classList.toggle("is-active", item === link);
            });
        }
    };

    const beginOptimisticPageNavigation = (nextUrl, {link = null, targetDockGroup = null} = {}) => {
        if (optimisticNavigationFrame) window.cancelAnimationFrame(optimisticNavigationFrame);
        const targetView = resolveViewFromUrl(nextUrl);
        const targetSection = targetView === "settings"
            ? resolveSettingsSectionFromUrl(nextUrl)
            : targetView === "trade"
                ? resolveTradeSectionFromUrl(nextUrl)
                : null;
        const dockGroup = targetDockGroup || resolveDockGroupFromView(targetView);
        captureOptimisticNavigationSnapshot();
        document.body.classList.add("is-workspace-switching", "is-page-navigating");
        document.documentElement.dataset.navigationTarget = targetView || "page";
        document.documentElement.setAttribute("aria-busy", "true");
        syncDockPreviewTarget(dockGroup);
        syncLocalPreviewTarget(link);
        renderOptimisticNavigationSkeleton({view: targetView, section: targetSection});
        let navigationCommitted = false;
        const commitNavigation = () => {
            if (navigationCommitted) return;
            navigationCommitted = true;
            optimisticNavigationFrame = 0;
            window.location.assign(nextUrl);
        };
        const fallbackTimer = window.setTimeout(commitNavigation, 120);
        optimisticNavigationFrame = window.requestAnimationFrame(() => {
            window.setTimeout(() => {
                window.clearTimeout(fallbackTimer);
                commitNavigation();
            }, 0);
        });
    };

    const fetchJsonCached = async (cacheKey, url, {ttlMs = 30000} = {}) => {
        const cached = progressiveResourceCache.get(cacheKey);
        const now = Date.now();
        if (cached && (now - cached.cachedAt) < ttlMs) return cached.value;
        const response = await fetch(url, {credentials: "same-origin"});
        if (!response.ok) throw new Error(`JSON fetch failed: ${response.status}`);
        const value = await response.json();
        progressiveResourceCache.set(cacheKey, {cachedAt: now, value});
        return value;
    };

    const requestWorkspaceChartTransition = (reason) => {
        pendingWorkspaceChartTransition = {
            view: state.currentView,
            reason,
            requestedAt: performance.now(),
        };
    };

    const clearWorkspaceChartTransitionRequest = () => {
        pendingWorkspaceChartTransition = null;
    };

    const captureLineChartRefreshTransition = () => {
        if (!Array.isArray(state.chart?.series) || !state.chart.series.length) {
            delete bootstrap.chartWorkspaceRefreshTransition;
            return;
        }
        bootstrap.chartWorkspaceRefreshTransition = {
            view: state.currentView,
            capturedAt: performance.now(),
            labels: [...(state.chart.series[0]?.dates || [])],
            series: state.chart.series.map((item) => ({
                ticker: item.ticker,
                dates: [...(item.dates || [])],
                values: [...(isMarketCapComparison() ? (item.market_caps || []) : (item.normalized_returns || []))],
            })),
        };
    };

    const captureBacktestRefreshTransition = () => {
        if (!isBacktestView || !state.backtestResult?.chart) return;
        const chartState = state.backtestResult.chart;
        if (!Array.isArray(chartState.dates) || !chartState.dates.length) {
            delete bootstrap.backtestRefreshTransition;
            return;
        }
        const initialCapital = Number(state.backtestResult.summary?.initial_capital || 0);
        const chartAxis = window.WORTHWARD_CHART_AXIS || {};
        const closeSeries = Array.isArray(chartState.close) ? [...chartState.close] : [];
        const openSeries = Array.isArray(chartState.open) ? [...chartState.open] : [];
        const allInSeries = Array.isArray(chartState.all_in_equity) && chartState.all_in_equity.length
            ? chartState.all_in_equity.map((value) => Number(value || 0))
            : typeof chartAxis.buildAllInEquitySeries === "function"
                ? chartAxis.buildAllInEquitySeries(openSeries, closeSeries, initialCapital)
                : [];
        bootstrap.backtestRefreshTransition = {
            capturedAt: performance.now(),
            rawLabels: Array.isArray(chartState.raw_dates) && chartState.raw_dates.length
                ? [...chartState.raw_dates]
                : [...chartState.dates],
            close: closeSeries,
            equity: Array.isArray(chartState.equity) ? [...chartState.equity] : [],
            allIn: allInSeries,
            initialCapital,
        };
    };

    const didPortfolioRequestChangeXAxis = (currentParams, nextParams) => {
        const currentTickers = Array.from(currentParams.getAll("ticker")).sort().join(",");
        const nextTickers = Array.from(nextParams.getAll("ticker")).sort().join(",");
        if (currentTickers !== nextTickers) return true;

        const xAxisKeys = ["period", "range", "date", "trading_date", "exact_trading_date", "from", "exact_start", "to", "exact_end", "return", "extended-hours", "extended_hours", "include_extended_hours", "overnight", "include_overnight", "price_only", "price_return_only", "dividends", "include_dividends"];
        for (const key of xAxisKeys) {
            const current = (currentParams.get(key) || "").toString().trim();
            const next = (nextParams.get(key) || "").toString().trim();
            if (current !== next) return true;
        }
        return false;
    };

    const appShell = $(".app-shell");
    const sidebarToggle = $("#sidebar_toggle");
    const appSidebar = $("#app_sidebar");
    const sidebarBackdrop = $("#sidebar_backdrop");
    const mobileSidebarMedia = responsive.media("sidebarOverlayMax");
    const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sidebarGelAnimationNames = new Set([
        "workspace-sidebar-gel-open",
        "workspace-sidebar-gel-close",
    ]);
    const sidebarGelCandidateSelector = [
        ".workspace-mobile-summary-shell[data-mobile-summary-fixed] > :not(.workspace-summary-card)",
        ".settings-workspace-header > :not(.settings-summary-card)",
    ].join(", ");
    const sidebarGelTargetSelector = "[data-sidebar-gel-content]";
    let isSidebarOpen = true;
    let sidebarGelMotionResetTimer = 0;
    let sidebarGelMotionEndHandler = null;

    const readSidebarMemory = () => {
        try {
            const storedValue = preferenceStorage.session.getItem(SIDEBAR_MEMORY_KEY);
            if (storedValue === "true") return true;
            if (storedValue === "false") return false;
        } catch (_error) {
        }
        return !mobileSidebarMedia.matches;
    };

    const writeSidebarMemory = (value) => {
        try {
            preferenceStorage.session.setItem(SIDEBAR_MEMORY_KEY, String(Boolean(value)));
        } catch (_error) {
        }
    };

    const clearSidebarGelMotion = (shell = appShell) => {
        if (sidebarGelMotionResetTimer) {
            window.clearTimeout(sidebarGelMotionResetTimer);
            sidebarGelMotionResetTimer = 0;
        }
        if (shell && sidebarGelMotionEndHandler) {
            shell.removeEventListener("animationend", sidebarGelMotionEndHandler);
        }
        sidebarGelMotionEndHandler = null;
        shell?.classList.remove("is-sidebar-animating", "is-sidebar-opening", "is-sidebar-closing");
    };

    const syncSidebarGelTargets = (shell = appShell) => {
        if (!shell) return [];
        const targets = Array.from(shell.querySelectorAll(sidebarGelCandidateSelector));
        targets.forEach((target) => target.setAttribute("data-sidebar-gel-content", ""));
        return targets;
    };

    const setSidebarGelMotionState = (direction, shell = appShell) => {
        clearSidebarGelMotion(shell);
        const motion = window.WorthwardMotion;
        const targets = syncSidebarGelTargets(shell);
        if (
            !shell
            || !direction
            || mobileSidebarMedia.matches
            || reducedMotionMedia.matches
            || motion?.isReducedMotion?.()
            || !targets.length
            || !shell.querySelector(sidebarGelTargetSelector)
        ) {
            return;
        }

        // Flush the cleared animation state before applying the new direction so
        // rapid reversals cannot inherit stale classes or completion handlers.
        void shell.offsetWidth;
        shell.classList.add(
            "is-sidebar-animating",
            direction === "opening" ? "is-sidebar-opening" : "is-sidebar-closing",
        );
        sidebarGelMotionEndHandler = (event) => {
            if (!sidebarGelAnimationNames.has(event.animationName)) return;
            clearSidebarGelMotion(shell);
        };
        shell.addEventListener("animationend", sidebarGelMotionEndHandler);
        const fallbackDuration = Number(motion?.durations?.spatial) || 560;
        sidebarGelMotionResetTimer = window.setTimeout(
            () => clearSidebarGelMotion(shell),
            fallbackDuration + 120,
        );
    };

    const applySidebarState = (nextIsOpen, shell = appShell, sidebar = appSidebar, toggle = sidebarToggle, backdrop = sidebarBackdrop) => {
        if (!(shell && sidebar && toggle)) return;
        isSidebarOpen = Boolean(nextIsOpen);
        document.documentElement.classList.toggle("sidebar-memory-collapsed", !isSidebarOpen);
        toggle.setAttribute("aria-hidden", "false");
        toggle.setAttribute("aria-expanded", String(isSidebarOpen));
        shell.classList.toggle("is-sidebar-open", isSidebarOpen);
        shell.classList.toggle("is-sidebar-collapsed", !isSidebarOpen);
        sidebar.hidden = false;
        sidebar.style.display = "";
        sidebar.setAttribute("aria-hidden", String(!isSidebarOpen));
        if ("inert" in sidebar) sidebar.inert = !isSidebarOpen;
        if (backdrop) {
            const shouldShowBackdrop = mobileSidebarMedia.matches && isSidebarOpen;
            backdrop.hidden = !shouldShowBackdrop;
            backdrop.setAttribute("aria-hidden", String(!shouldShowBackdrop));
            if ("inert" in backdrop) backdrop.inert = !shouldShowBackdrop;
            backdrop.tabIndex = shouldShowBackdrop ? 0 : -1;
        }
        scheduleWorkspaceSummaryMorphSync?.();
    };

    let sidebarFlipCancel = null;
    const applySidebarStateWithMotion = (nextIsOpen) => {
        const commitSidebarState = () => {
            applySidebarState(nextIsOpen);
            setSidebarGelMotionState(nextIsOpen ? "opening" : "closing");
        };
        // During expansion the sidebar occupies the final layout slot immediately;
        // keeping the title in that slot prevents it from crossing the glass panel.
        if (nextIsOpen) {
            sidebarFlipCancel?.();
            sidebarFlipCancel = null;
            commitSidebarState();
            return;
        }
        const targets = $$(".workspace-summary-card .report-heading, .workspace-mode-title-card .report-heading, .settings-summary-card .report-heading")
            .filter((element) => element.getClientRects().length > 0);
        const motion = window.WorthwardMotion;
        if (!motion?.flip || !targets.length) {
            commitSidebarState();
            return;
        }
        sidebarFlipCancel?.();
        sidebarFlipCancel = motion.flip(targets, commitSidebarState, {
            duration: motion.durations.spatial,
            easing: motion.easingTokens?.emphasized,
        });
    };

    if (sidebarToggle && appSidebar && appShell) {
        syncSidebarGelTargets();
        applySidebarState(readSidebarMemory());
        sidebarToggle.addEventListener("click", () => {
            applySidebarStateWithMotion(!isSidebarOpen);
            writeSidebarMemory(isSidebarOpen);
            scheduleDockPosition();
        });
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener("click", () => {
            if (!mobileSidebarMedia.matches || !isSidebarOpen) return;
            applySidebarStateWithMotion(false);
            writeSidebarMemory(false);
            scheduleDockPosition();
        });
    }

    if (typeof mobileSidebarMedia.addEventListener === "function") {
        mobileSidebarMedia.addEventListener("change", () => {
            clearSidebarGelMotion();
            applySidebarState(isSidebarOpen);
            scheduleMobilePageBottomPaddingSync();
        });
    } else if (typeof mobileSidebarMedia.addListener === "function") {
        mobileSidebarMedia.addListener(() => {
            clearSidebarGelMotion();
            applySidebarState(isSidebarOpen);
            scheduleMobilePageBottomPaddingSync();
        });
    }

    if (typeof reducedMotionMedia.addEventListener === "function") {
        reducedMotionMedia.addEventListener("change", () => clearSidebarGelMotion());
    } else if (typeof reducedMotionMedia.addListener === "function") {
        reducedMotionMedia.addListener(() => clearSidebarGelMotion());
    }

    const getTickerFields = () => $$(".ticker-field");
    const getTickerInputs = () => getTickerFields().map((field) => field.querySelector("[data-ticker-input]")).filter(Boolean);
    const getFilledTickers = () => getTickerInputs().map((input) => sanitizeTicker(input.value.trim())).filter(Boolean);
    const nonUsMarketSuffixes = new Set([
        "AS", "AX", "BA", "BE", "BK", "BO", "BR", "CA", "CN", "CO", "DE", "DU", "F", "HA",
        "HE", "HK", "HM", "IR", "IS", "JK", "JP", "KL", "KQ", "KS", "L", "MC", "MI",
        "MX", "NE", "NS", "NZ", "OL", "PA", "QA", "SA", "SE", "SG", "SH", "SI", "SR",
        "SS", "ST", "SW", "SZ", "T", "TA", "TO", "TWO", "TW", "V", "VI",
    ]);
    const isUsTicker = (ticker) => {
        const normalizedTicker = sanitizeTicker(ticker);
        if (!normalizedTicker.includes(".")) return true;
        const suffix = normalizedTicker.split(".").pop() || "";
        return suffix === "US" || !nonUsMarketSuffixes.has(suffix);
    };
    const areAllFilledTickersUs = () => {
        const tickers = getFilledTickers();
        return tickers.length > 0 && tickers.every(isUsTicker);
    };
    const getWeightFields = () => getTickerFields().map((field, index) => ({
        index,
        field,
        number: field.querySelector('.portfolio-weight-input'),
        slider: field.querySelector('.portfolio-weight-slider'),
        shares: field.querySelector('.portfolio-share-input'),
        tickerInput: field.querySelector("[data-ticker-input]"),
        tooltip: field.querySelector('.portfolio-weight-tooltip'),
    })).filter((item) => item.number && item.slider && item.tickerInput);
    const getPortfolioAllocationInputs = () => Array.from(document.querySelectorAll("[data-portfolio-allocation-input]"))
        .filter((input) => input instanceof HTMLInputElement);
    const getPortfolioAllocationMode = () => {
        const checked = getPortfolioAllocationInputs().find((input) => input.checked);
        return checked?.value === "shares" ? "shares" : "weight";
    };
    const isPortfolioShareMode = () => isPortfolioView && getPortfolioAllocationMode() === "shares";

    const attachNoticeHandlers = () => {
        $$("[data-dismissible-notice]").forEach((noticeElement) => {
            const closeButton = noticeElement.querySelector(".notice-close");
            if (!closeButton || closeButton.dataset.bound === "1") return;
            closeButton.dataset.bound = "1";
            closeButton.addEventListener("click", () => {
                noticeElement.hidden = true;
            });
        });
    };

    const attachTradeDetailTabs = () => {
        const shell = $("[data-trade-detail-shell]");
        if (!shell) return;
        const panels = $$("[data-trade-detail-panel]");
        const urlState = workspaceUrlState?.parseWorkspaceUrlState?.(window.location.href);
        try {
            const storedValue = preferenceStorage.session.getItem(TRADE_DETAIL_MEMORY_KEY);
            const requestedValue = urlState?.tab === "transactions"
                || (urlState?.tab === "metrics" && window.location.search.includes("tab="))
                ? urlState.tab
                : storedValue;
            const storedInput = requestedValue ? shell.querySelector(`input[name="trade_detail_tab"][value="${requestedValue}"]`) : null;
            if (storedInput) storedInput.checked = true;
        } catch (_error) {
        }
        const syncPanels = ({syncUrl = false} = {}) => {
            const active = shell.querySelector('input[name="trade_detail_tab"]:checked')?.value || "metrics";
            shell.dataset.active = active;
            try {
                preferenceStorage.session.setItem(TRADE_DETAIL_MEMORY_KEY, active);
            } catch (_error) {
            }
            panels.forEach((panel) => {
                panel.hidden = panel.dataset.tradeDetailPanel !== active;
            });
            if (syncUrl && typeof buildCleanWorkspaceUrl === "function") {
                const nextUrl = buildCleanWorkspaceUrl();
                const currentUrl = `${window.location.pathname}${window.location.search}`;
                if (nextUrl !== currentUrl) {
                    window.history.pushState({}, "", nextUrl);
                    rememberCurrentViewUrl(nextUrl);
                }
            }
        };
        shell.querySelectorAll('input[name="trade_detail_tab"]').forEach((input) => {
            if (input.dataset.bound === "1") return;
            input.dataset.bound = "1";
            input.addEventListener("change", () => syncPanels({syncUrl: true}));
        });
        syncPanels();
    };

    const setFormBusyState = (isBusy) => {
        if (!form) return;
        form.setAttribute("aria-busy", String(isBusy));
    };

    const fetchMissingLocalMarketTickers = async (tickers) => {
        if (!Array.isArray(tickers) || !tickers.length || !endpoints.marketStorePresence) return [];
        const canonicalTickers = tickers
            .map((ticker) => String(ticker || "").trim().toUpperCase())
            .filter(Boolean)
            .filter((ticker, index, list) => list.indexOf(ticker) === index)
            .sort();
        if (!canonicalTickers.length) return [];
        const tickerKey = canonicalTickers.join("|");
        const now = Date.now();
        const cached = localMarketPresenceRequestCache.get(tickerKey);
        if (cached && cached.expiresAt > now) {
            return [...cached.value];
        }
        if (localMarketPresencePendingRequest.has(tickerKey)) {
            return localMarketPresencePendingRequest.get(tickerKey);
        }
        const params = new URLSearchParams();
        canonicalTickers.forEach((ticker) => {
            if (ticker) params.append("ticker", ticker);
        });
        const request = (async () => {
            const response = await fetch(`${endpoints.marketStorePresence}?${params.toString()}`, {
                credentials: "same-origin",
            });
            if (!response.ok) throw new Error(`Market store presence fetch failed: ${response.status}`);
            const payload = await response.json();
            const missingHistory = Array.isArray(payload?.missingHistory) ? payload.missingHistory : [];
            localMarketPresenceRequestCache.set(tickerKey, {
                value: [...missingHistory],
                expiresAt: Date.now() + 4000,
            });
            return [...missingHistory];
        })();
        localMarketPresencePendingRequest.set(tickerKey, request);
        try {
            return await request;
        } finally {
            localMarketPresencePendingRequest.delete(tickerKey);
        }
    };

    const attachWorkspaceSummaryMorph = () => {
        if (typeof activeWorkspaceSummaryMorphCleanup === "function") {
            activeWorkspaceSummaryMorphCleanup();
            activeWorkspaceSummaryMorphCleanup = null;
        }
        const summaryShells = Array.from(document.querySelectorAll(".workspace-mobile-summary-shell[data-mobile-summary-fixed]"));
        const sidebar = document.getElementById("app_sidebar");
        if (!summaryShells.length || !(sidebar instanceof HTMLElement)) return;
        const mobileMedia = responsive.media("contentStackMax");
        let frameId = 0;
        let resizeObserver = null;
        const summaryCards = summaryShells
            .map((shell) => shell.querySelector(":scope > .workspace-summary-card"))
            .filter((card) => card instanceof HTMLElement);
        if (!summaryCards.length) return;

        const clearMorph = () => {
            summaryCards.forEach((card) => {
                card.style.removeProperty("--workspace-summary-morph-translate-x");
                card.style.removeProperty("--workspace-summary-morph-translate-y");
                card.style.removeProperty("--workspace-summary-morph-scale-x");
                card.style.removeProperty("--workspace-summary-morph-scale-y");
            });
        };

        const syncMorph = () => {
            frameId = 0;
            if (!mobileMedia.matches) {
                clearMorph();
                return;
            }
            const sidebarRect = sidebar.getBoundingClientRect();
            const sidebarStyles = window.getComputedStyle(sidebar);
            const targetLeft = Number.parseFloat(sidebarStyles.left || "") || sidebarRect.left;
            const targetTop = Number.parseFloat(sidebarStyles.top || "") || sidebarRect.top;
            const targetBottom = Number.parseFloat(sidebarStyles.bottom || "") || 0;
            const targetWidth = sidebarRect.width > 0 ? sidebarRect.width : Math.max(1, window.innerWidth - (targetLeft * 2));
            const targetHeight = Math.max(1, window.innerHeight - targetTop - targetBottom);
            summaryCards.forEach((card) => {
                const summaryRect = card.getBoundingClientRect();
                if (!(summaryRect.width > 0) || !(summaryRect.height > 0)) {
                    card.style.removeProperty("--workspace-summary-morph-translate-x");
                    card.style.removeProperty("--workspace-summary-morph-translate-y");
                    card.style.removeProperty("--workspace-summary-morph-scale-x");
                    card.style.removeProperty("--workspace-summary-morph-scale-y");
                    return;
                }
                card.style.setProperty("--workspace-summary-morph-translate-x", `${targetLeft - summaryRect.left}px`);
                card.style.setProperty("--workspace-summary-morph-translate-y", `${targetTop - summaryRect.top}px`);
                card.style.setProperty("--workspace-summary-morph-scale-x", `${targetWidth / summaryRect.width}`);
                card.style.setProperty("--workspace-summary-morph-scale-y", `${targetHeight / summaryRect.height}`);
            });
        };

        const scheduleMorphSync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncMorph);
        };
        scheduleWorkspaceSummaryMorphSync = scheduleMorphSync;

        scheduleMorphSync();
        window.addEventListener("resize", scheduleMorphSync);
        if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleMorphSync);
        if (typeof mobileMedia.addEventListener === "function") {
            mobileMedia.addEventListener("change", scheduleMorphSync);
        } else if (typeof mobileMedia.addListener === "function") {
            mobileMedia.addListener(scheduleMorphSync);
        }
        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(scheduleMorphSync);
            summaryCards.forEach((card) => resizeObserver.observe(card));
            resizeObserver.observe(sidebar);
        }

        activeWorkspaceSummaryMorphCleanup = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            window.removeEventListener("resize", scheduleMorphSync);
            if (window.visualViewport) window.visualViewport.removeEventListener("resize", scheduleMorphSync);
            if (typeof mobileMedia.removeEventListener === "function") {
                mobileMedia.removeEventListener("change", scheduleMorphSync);
            } else if (typeof mobileMedia.removeListener === "function") {
                mobileMedia.removeListener(scheduleMorphSync);
            }
            resizeObserver?.disconnect();
            clearMorph();
            scheduleWorkspaceSummaryMorphSync = null;
        };
    };

    const attachWorkspaceModeLayout = () => {
        if (typeof activeWorkspaceModeLayoutCleanup === "function") {
            activeWorkspaceModeLayoutCleanup();
            activeWorkspaceModeLayoutCleanup = null;
        }
        const sidebar = document.getElementById("app_sidebar");
        const layout = document.querySelector(".workspace-mode-layout");
        const resultsStack = document.querySelector(".workspace-mode-results-stack");
        if (!(sidebar instanceof HTMLElement) || !(layout instanceof HTMLElement) || !(resultsStack instanceof HTMLElement)) {
            return;
        }
        const stackedWorkspaceMedia = responsive.media("contentStackMax");
        let frameId = 0;
        let resizeObserver = null;
        const resetLayoutHeight = () => {
            setInlineStyleIfChanged(layout, "--workspace-mode-aligned-height", "auto");
        };
        const syncLayoutHeight = () => {
            if (stackedWorkspaceMedia.matches) {
                resetLayoutHeight();
                return;
            }
            const sidebarRect = sidebar.getBoundingClientRect();
            const layoutRect = layout.getBoundingClientRect();
            const alignedHeight = Math.floor(sidebarRect.bottom - layoutRect.top);
            if (alignedHeight > 360) {
                setInlineStyleIfChanged(layout, "--workspace-mode-aligned-height", `${alignedHeight}px`);
                return;
            }
            resetLayoutHeight();
        };
        const scheduleLayoutSync = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                frameId = 0;
                syncLayoutHeight();
            });
        };
        scheduleLayoutSync();
        window.addEventListener("resize", scheduleLayoutSync);
        window.addEventListener("orientationchange", scheduleLayoutSync);
        window.addEventListener("pageshow", scheduleLayoutSync);
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", scheduleLayoutSync);
        }
        if (typeof stackedWorkspaceMedia.addEventListener === "function") {
            stackedWorkspaceMedia.addEventListener("change", scheduleLayoutSync);
        } else if (typeof stackedWorkspaceMedia.addListener === "function") {
            stackedWorkspaceMedia.addListener(scheduleLayoutSync);
        }
        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(scheduleLayoutSync);
            resizeObserver.observe(sidebar);
            resizeObserver.observe(layout);
            resizeObserver.observe(resultsStack);
        }
        activeWorkspaceModeLayoutCleanup = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            window.removeEventListener("resize", scheduleLayoutSync);
            window.removeEventListener("orientationchange", scheduleLayoutSync);
            window.removeEventListener("pageshow", scheduleLayoutSync);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener("resize", scheduleLayoutSync);
            }
            if (typeof stackedWorkspaceMedia.removeEventListener === "function") {
                stackedWorkspaceMedia.removeEventListener("change", scheduleLayoutSync);
            } else if (typeof stackedWorkspaceMedia.removeListener === "function") {
                stackedWorkspaceMedia.removeListener(scheduleLayoutSync);
            }
            resizeObserver?.disconnect();
            resetLayoutHeight();
        };
    };

    const attachScrollableDataTableHeaderMeasurements = () => {
        if (typeof activeScrollableTableHeaderCleanup === "function") {
            activeScrollableTableHeaderCleanup();
            activeScrollableTableHeaderCleanup = null;
        }
        if (window.WORTHWARD_TABLES?.attachAll) {
            activeScrollableTableHeaderCleanup = window.WORTHWARD_TABLES.attachAll(
                document.getElementById("workspace_panel") || document,
            );
            return;
        }
        const headerHeightProperty = "--scrollable-data-table-header-height";
        const scrollbarWidthProperty = "--scrollable-data-table-scrollbar-width";
        const overlayBorderCompensationProperty = "--scrollable-data-table-overlay-border-compensation";
        let frameId = 0;
        let resizeObserver = null;
        let mutationObserver = null;
        const observedShells = new Set();
        const observedHeaders = new Set();
        const observedScrollContainers = new Set();
        const observedBodyTables = new Set();

        const getOverlayHeader = (shell) => (
            Array.from(shell.children).find((child) => (
                child instanceof HTMLTableElement
                && child.matches('table[aria-hidden="true"]')
            )) || null
        );
        const getCurrentShells = () => (
            Array.from(new Set($$(".scrollable-data-table-shell")))
                .filter((shell) => shell instanceof HTMLElement)
        );
        const getScrollContainer = (shell) => (
            Array.from(shell.children).find((child) => (
                child instanceof HTMLElement
                && child.classList.contains("scrollable-data-table-scroll")
            )) || shell.querySelector(".scrollable-data-table-scroll")
        );
        const getBodyTable = (scrollContainer) => (
            scrollContainer?.querySelector("table:not([aria-hidden='true'])") || null
        );
        const observeShell = (shell) => {
            if (!resizeObserver || observedShells.has(shell)) return;
            resizeObserver.observe(shell);
            observedShells.add(shell);
        };
        const observeHeader = (overlayHeader) => {
            if (!resizeObserver || observedHeaders.has(overlayHeader)) return;
            resizeObserver.observe(overlayHeader);
            observedHeaders.add(overlayHeader);
        };
        const observeScrollContainer = (scrollContainer) => {
            if (!resizeObserver || observedScrollContainers.has(scrollContainer)) return;
            resizeObserver.observe(scrollContainer);
            observedScrollContainers.add(scrollContainer);
        };
        const observeBodyTable = (bodyTable) => {
            if (!resizeObserver || observedBodyTables.has(bodyTable)) return;
            resizeObserver.observe(bodyTable);
            observedBodyTables.add(bodyTable);
        };
        const roundUpToDevicePixel = (value) => {
            const scale = window.devicePixelRatio || 1;
            return Math.ceil(value * scale) / scale;
        };
        const getBodyColumnMetrics = (bodyTable) => {
            if (!(bodyTable instanceof HTMLTableElement)) return null;
            const row = Array.from(bodyTable.rows).find((candidate) => candidate.cells.length);
            if (!row) return null;
            const cells = Array.from(row.cells);
            const widths = cells.map((cell) => cell.getBoundingClientRect().width);
            const lastCell = cells[widths.length - 1] || null;
            return {
                lastCellRight: lastCell?.getBoundingClientRect().right || 0,
                widths,
            };
        };
        const syncOverlayColumnWidths = (overlayHeader, bodyTable, trailingTrackWidth) => {
            if (!(overlayHeader instanceof HTMLTableElement) || !(bodyTable instanceof HTMLTableElement)) return;
            const bodyColumnMetrics = getBodyColumnMetrics(bodyTable);
            const columnWidths = bodyColumnMetrics?.widths || [];
            if (!columnWidths.length) return;
            Array.from(overlayHeader.children).forEach((child) => {
                if (child instanceof HTMLElement && child.tagName === "COLGROUP") {
                    child.remove();
                }
            });
            const lastIndex = columnWidths.length - 1;
            columnWidths[lastIndex] = Math.max(1, columnWidths[lastIndex] + trailingTrackWidth);
            Array.from(overlayHeader.rows).forEach((row) => {
                Array.from(row.cells).forEach((cell, index) => {
                    if (index >= columnWidths.length) return;
                    cell.style.width = `${columnWidths[index] || 1}px`;
                });
            });
        };
        const syncShell = (shell) => {
            observeShell(shell);
            const overlayHeader = getOverlayHeader(shell);
            if (!(overlayHeader instanceof HTMLElement)) {
                shell.style.removeProperty(headerHeightProperty);
                shell.style.removeProperty(scrollbarWidthProperty);
                shell.style.removeProperty(overlayBorderCompensationProperty);
                return;
            }
            observeHeader(overlayHeader);
            const scrollContainer = getScrollContainer(shell);
            const bodyTable = getBodyTable(scrollContainer);
            if (scrollContainer instanceof HTMLElement) {
                observeScrollContainer(scrollContainer);
                const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
                let trailingTrackWidth = scrollbarWidth;
                if (bodyTable instanceof HTMLTableElement) {
                    const bodyColumnMetrics = getBodyColumnMetrics(bodyTable);
                    if (bodyColumnMetrics && bodyColumnMetrics.lastCellRight > 0) {
                        trailingTrackWidth = Math.max(
                            0,
                            shell.getBoundingClientRect().right - bodyColumnMetrics.lastCellRight
                        );
                    }
                }
                shell.style.setProperty(scrollbarWidthProperty, `${trailingTrackWidth}px`);
                shell.style.setProperty(
                    overlayBorderCompensationProperty,
                    `${trailingTrackWidth > 0 ? 1 : 0}px`
                );
                if (bodyTable instanceof HTMLTableElement) {
                    observeBodyTable(bodyTable);
                    syncOverlayColumnWidths(overlayHeader, bodyTable, trailingTrackWidth);
                }
            }
            const headerHeight = overlayHeader.getBoundingClientRect().height;
            if (headerHeight > 0) {
                shell.style.setProperty(headerHeightProperty, `${roundUpToDevicePixel(headerHeight)}px`);
            }
        };
        const syncAll = () => {
            getCurrentShells().forEach(syncShell);
        };
        const scheduleSync = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                frameId = 0;
                syncAll();
            });
        };

        syncAll();
        window.addEventListener("resize", scheduleSync);
        window.addEventListener("orientationchange", scheduleSync);
        window.addEventListener("pageshow", scheduleSync);
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", scheduleSync);
        }
        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(scheduleSync);
            syncAll();
        }
        if (typeof MutationObserver === "function") {
            mutationObserver = new MutationObserver(scheduleSync);
            const mutationRoot = document.getElementById("workspace_panel") || document.body;
            mutationObserver.observe(mutationRoot, {
                attributes: true,
                attributeFilter: ["hidden", "class", "style", "aria-hidden"],
                childList: true,
                subtree: true,
                characterData: true,
            });
        }
        activeScrollableTableHeaderCleanup = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            window.removeEventListener("resize", scheduleSync);
            window.removeEventListener("orientationchange", scheduleSync);
            window.removeEventListener("pageshow", scheduleSync);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener("resize", scheduleSync);
            }
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            observedShells.forEach((shell) => {
                shell.style.removeProperty(headerHeightProperty);
                shell.style.removeProperty(scrollbarWidthProperty);
                shell.style.removeProperty(overlayBorderCompensationProperty);
            });
            observedShells.clear();
            observedHeaders.clear();
            observedScrollContainers.clear();
            observedBodyTables.clear();
        };
    };

    const initializeSettingsWorkspace = () => {
        bootstrap.initSettingsWorkspace?.({
            state,
            endpoints,
            labels,
            canTransitionDom,
            rememberCurrentViewUrl,
            getProgressiveManifest,
            renderOptimisticNavigationSkeleton,
            clearOptimisticNavigationSkeleton,
            fetchJsonCached,
            progressiveResourceCache,
        });
    };

    window.addEventListener("worthward:settings-bootstrap-ready", initializeSettingsWorkspace);

    const initializeWorkspaceEnhancements = () => {
        initMobilePageBottomPadding();
        attachNoticeHandlers();
        attachTradeDetailTabs();
        bootstrap.initWorkspaceShareDrawer?.();
        attachWorkspaceSummaryMorph();
        attachWorkspaceModeLayout();
        attachScrollableDataTableHeaderMeasurements();
        initializeSettingsWorkspace();
        window.requestAnimationFrame(() => {
            window.WORTHWARD_BOOTSTRAP?.initChartWorkspace?.();
            window.WORTHWARD_BOOTSTRAP?.initPriceCompareWorkspace?.();
            window.WORTHWARD_BOOTSTRAP?.initPortfolioWorkspace?.();
            window.WORTHWARD_BOOTSTRAP?.initDcaWorkspace?.();
            window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
            window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
            if (state.currentView === "portfolio") {
                dispatchPortfolioPreviewUpdate();
            }
        });
    };

    const buildPendingWorkspaceMarkup = () => {
        const currentValues = getFilledTickers();
        const reportHeading = $(".workspace .report-heading")?.textContent?.trim() || labels.backtest_metrics || translateUi("Loading");
        const chartHeading = $(".workspace .chart-heading")?.textContent?.trim() || translateUi("Loading");
        if (state.currentView === "backtest") {
            const showBacktestTradeDetails = showTradeDetailsInput instanceof HTMLInputElement
                ? showTradeDetailsInput.checked
                : true;
            const priceFieldStrategyIds = Array.isArray(state.priceFieldStrategyIds)
                && state.priceFieldStrategyIds.length
                ? state.priceFieldStrategyIds
                : (window.WORTHWARD_BACKTEST_PROBABILITY_GRID?.PRICE_FIELD_STRATEGY_IDS
                    || ["bayesian-price-field", "lstm-price-field"]);
            const showBacktestProbabilityField = priceFieldStrategyIds.includes(
                state.selectedStrategyId,
            );
            const tradeMetricLabels = [
                "Initial capital",
                "Final equity",
                "Net return",
                "Total trades",
                "Win rate",
                "Beat B&H",
                "Alpha vs B&H",
                "Realized long P&L",
                "Realized short P&L",
                "Realized long loss",
            ];
            const pendingMetricCards = tradeMetricLabels.map((label) => (
                `<div class="trade-metric-card"><span class="trade-metric-label">${label}</span><span class="trade-metric-value is-pending-value" data-workspace-mask="trade-metric">0000</span></div>`
            )).join("");
            const pendingTransactionRows = Array.from({length: 4}, (_, index) => `
                <tr>
                    <td class="trade-transactions-index">${index + 1}</td>
                    <td class="is-pending-value">0000</td>
                    <td class="is-pending-value">0000</td>
                    <td class="trade-transactions-number is-pending-value">0000</td>
                    <td class="trade-transactions-number is-pending-value">0000</td>
                    <td class="trade-transactions-number is-pending-value">0000</td>
                    <td class="trade-transactions-number is-pending-value">0000</td>
                    <td class="trade-transactions-number is-pending-value">0000</td>
                    <td class="trade-transactions-number is-pending-value">0000</td>
                    <td class="trade-transactions-number is-pending-value">0000</td>
                </tr>
            `).join("");
            return `
                <section class="workspace-header workspace-mobile-summary-shell workspace-mode-results-stack backtest-results-stack investment-workspace-header" data-mobile-summary-fixed>
                    <article class="report-card workspace-article-card workspace-summary-card">
                        <div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
                    </article>
                    <article class="report-card workspace-content-card trade-performance-card investment-report-card backtest-trade-performance-card">
                        <div class="investment-surface-stack investment-view-surface backtest-view-surface" id="backtest_view_surface" data-active-view="overview">
                            <div class="investment-view-surface-body backtest-view-surface-body" id="backtest_view_surface_body">
                                <div id="backtest_overview_panel" data-backtest-view-panel="overview">
                                    <article class="chart-surface backtest-surface">
                                        <div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
                                        <div class="trade-chart-stack${showBacktestTradeDetails ? "" : " is-trade-details-hidden"}"
                                             data-backtest-trade-chart-stack
                                             data-trade-details-visible="${showBacktestTradeDetails}">
                                            <div class="trade-chart-panel is-pending-value" data-workspace-mask="trade-chart"></div>
                                            <div class="trade-chart-panel trade-chart-panel-equity is-pending-value"
                                                 data-backtest-equity-panel
                                                 data-workspace-mask="trade-chart"${showBacktestTradeDetails ? "" : " hidden aria-hidden=\"true\""}></div>
                                        </div>
                                    </article>
                                </div>
                            </div>
                        </div>
                    </article>
                    <div class="backtest-section-resizer-slot" data-backtest-section-resizer-slot>
                        <button type="button"
                                class="surface-resizer surface-resizer--block surface-resizer--reveal investment-section-resizer backtest-section-resizer"
                                id="backtest_section_resizer"
                                data-backtest-section-resizer
                                role="separator"
                                aria-orientation="horizontal"
                                aria-label="Resize backtest overview and transaction history"></button>
                        <div class="backtest-probability-scrollport"
                             data-backtest-probability-scrollport
                             role="region"
                             aria-label="Pan chart to reveal the probability field"
                             aria-hidden="true"
                             tabindex="-1"
                             hidden>
                            <span class="backtest-probability-scrollport-spacer"
                                  data-backtest-probability-scrollport-spacer
                                  aria-hidden="true"></span>
                        </div>
                    </div>
                <article class="chart-surface investment-history-surface backtest-history-surface"
                         id="backtest_history_surface"
                         data-active-view="${showBacktestTradeDetails ? "transactions" : "metrics"}"
                         data-trade-details-visible="${showBacktestTradeDetails}">
                    <div class="investment-view-segmented-wrap backtest-history-view-segmented-wrap">
                        <div class="segmented-control-overflow-frame investment-view-segmented-frame backtest-history-view-segmented-frame"
                             data-segmented-overflow-frame data-overflow-start="0" data-overflow-end="0">
                            <div class="segmented-control segmented-control--compact investment-view-segmented backtest-history-view-segmented"
                                 id="backtest_history_view_segmented" data-backtest-history-view-segmented data-active="${showBacktestTradeDetails ? "transactions" : "metrics"}" data-option-count="${showBacktestProbabilityField ? "3" : "2"}" data-segmented-pill="measured" data-segmented-overflow-mode="peek">
                                <label class="segmented-control-option" for="backtest_history_metrics"><input id="backtest_history_metrics" name="backtest_history_view_tab" type="radio" value="metrics"${showBacktestTradeDetails ? "" : " checked"}><span>Metrics</span></label>
                                ${showBacktestProbabilityField ? '<label class="segmented-control-option" for="backtest_history_probability"><input id="backtest_history_probability" name="backtest_history_view_tab" type="radio" value="probability"><span>Price Field</span></label>' : ""}
                                <label class="segmented-control-option" for="backtest_history_transactions" data-backtest-history-transactions-option${showBacktestTradeDetails ? "" : " aria-disabled=\"true\""}><input id="backtest_history_transactions" name="backtest_history_view_tab" type="radio" value="transactions" data-backtest-history-transactions${showBacktestTradeDetails ? " checked" : " disabled"}><span>Transactions</span></label>
                            </div>
                        </div>
                    </div>
                    <div class="investment-view-surface-body backtest-history-view-body" id="backtest_history_view_body">
                        <div id="backtest_history_metrics_panel" data-backtest-history-view-panel="metrics"${showBacktestTradeDetails ? " hidden" : ""}>
                            <div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid" id="backtest_metrics_panel">${pendingMetricCards}</div>
                        </div>
                        ${showBacktestProbabilityField ? `
                        <section class="backtest-probability-detail-panel"
                                 id="backtest_probability_detail_panel"
                                 data-backtest-probability-detail-panel
                                 data-backtest-history-view-panel="probability"
                                 role="region"
                                 aria-labelledby="backtest_probability_detail_title"
                                 hidden
                                 aria-hidden="true">
                            <div class="backtest-probability-detail-heading">
                                <p class="chart-heading" id="backtest_probability_detail_title">${state.selectedStrategyId === "lstm-price-field" ? "LSTM Price Field detail" : "Bayesian Price Field detail"}</p>
                                <div class="backtest-probability-detail-status-row">
                                    <p class="backtest-probability-detail-status" data-backtest-probability-detail-status aria-live="polite">
                                        Hover a price point to inspect its forecast field.
                                    </p>
                                </div>
                            </div>
                            <div class="backtest-probability-detail-plot" data-backtest-probability-detail-plot>
                                <div class="backtest-probability-detail-y-axis">
                                    <div class="backtest-probability-detail-y-axis-viewport" data-backtest-probability-detail-y-axis></div>
                                </div>
                                <div class="backtest-probability-detail-main">
                                    <div class="backtest-probability-detail-grid-viewport" data-backtest-probability-detail-grid-viewport>
                                        <div class="backtest-probability-detail-grid" data-backtest-probability-detail-grid role="img" aria-label="Future price probability field"></div>
                                        <span class="backtest-probability-detail-anchor" data-backtest-probability-detail-anchor aria-hidden="true"></span>
                                        <div class="backtest-probability-detail-side-summary" role="group" aria-label="Average probability mass per forecast horizon by price direction">
                                            <span class="backtest-probability-detail-side-summary-value is-up" data-backtest-probability-detail-up-summary></span>
                                            <span class="backtest-probability-detail-side-summary-value is-down" data-backtest-probability-detail-down-summary></span>
                                        </div>
                                    </div>
                                    <div class="backtest-probability-detail-x-axis" data-backtest-probability-detail-x-axis>
                                    </div>
                                </div>
                            </div>
                        </section>
                        ` : ""}
                        <div id="backtest_history_transactions_panel" data-backtest-history-view-panel="transactions"${showBacktestTradeDetails ? "" : " hidden"}>
                    <div class="investment-stock-details-table-host scrollable-data-table-shell local-store-pagination-host investment-history-table-shell backtest-history-table-shell" id="backtest_history_table_wrap">
                        <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table backtest-history-table" data-table-header aria-label="Transaction details columns">
                            <colgroup>
                                <col style="width: var(--backtest-col-no-width);">
                                <col style="width: var(--backtest-col-date-time-width);">
                                <col style="width: var(--backtest-col-side-width);">
                                <col style="width: var(--backtest-col-price-width);">
                                <col style="width: var(--backtest-col-quantity-width);">
                                <col style="width: var(--backtest-col-realized-pnl-width);">
                                <col style="width: var(--backtest-col-unrealized-pnl-width);">
                                <col style="width: var(--backtest-col-cash-width);">
                                <col style="width: var(--backtest-col-market-value-width);">
                                <col style="width: var(--backtest-col-equity-width);">
                            </colgroup>
                            <thead><tr><th>No.</th><th>Date time</th><th>Side</th><th>Price</th><th>Quantity</th><th>Realized P&amp;L</th><th>Unrealized P&amp;L</th><th>Cash</th><th>Market value</th><th>Equity</th></tr></thead>
                        </table>
                        <div class="trade-transactions-wrap scrollable-data-table-scroll investment-history-table-scroll" id="backtest_history_table_scroll" data-table-scroll>
                            <table id="tradeTransactionsTable" class="settings-table trade-transactions-table scrollable-data-table investment-history-table backtest-history-table" data-table-body>
                                <colgroup>
                                    <col style="width: var(--backtest-col-no-width);">
                                    <col style="width: var(--backtest-col-date-time-width);">
                                    <col style="width: var(--backtest-col-side-width);">
                                    <col style="width: var(--backtest-col-price-width);">
                                    <col style="width: var(--backtest-col-quantity-width);">
                                    <col style="width: var(--backtest-col-realized-pnl-width);">
                                    <col style="width: var(--backtest-col-unrealized-pnl-width);">
                                    <col style="width: var(--backtest-col-cash-width);">
                                    <col style="width: var(--backtest-col-market-value-width);">
                                    <col style="width: var(--backtest-col-equity-width);">
                                </colgroup>
                                <tbody>${pendingTransactionRows}</tbody>
                            </table>
                        </div>
                    </div>
                        </div>
                    </div>
                </article>
                </section>
            `;
        }
        if (state.currentView === "dca") {
            const dcaMetricLabels = [
                "Amount per period",
                "Total invested",
                "Final equity",
                "Net return",
                "Total buys",
                "Total shares",
                "Average cost",
                "If all in",
                "vs all in",
            ];
            return `
				<section class="workspace-header workspace-mobile-summary-shell" data-mobile-summary-fixed>
					<article class="report-card workspace-article-card workspace-summary-card">
						<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
					</article>
					<article class="report-card workspace-content-card trade-performance-card backtest-trade-performance-card">
						<div class="trade-detail-tabs">
							<div class="trade-detail-toolbar">
								<div class="range-mode-shell segmented-control--compact trade-detail-shell" data-active="metrics">
									<span class="segmented-control-option"><span>${labels.dca_metrics_tab}</span></span>
									<span class="segmented-control-option"><span>${labels.dca_transactions_tab}</span></span>
								</div>
							</div>
							<div class="trade-detail-panel">
								<div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid" id="backtest_metrics_panel">
									${dcaMetricLabels.map((label) => `<div class="trade-metric-card"><span class="trade-metric-label">${label}</span><span class="trade-metric-value is-pending-value" data-workspace-mask="trade-metric">0000</span></div>`).join("")}
								</div>
							</div>
						</div>
					</article>
					<article class="chart-surface backtest-surface">
						<div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
						<div class="trade-chart-stack">
							<div class="trade-chart-panel is-pending-value" data-workspace-mask="trade-price-chart"></div>
							<div class="trade-chart-panel trade-chart-panel-equity is-pending-value" data-workspace-mask="trade-equity-chart"></div>
						</div>
					</article>
				</section>
			`;
        }
        if (state.currentView === "portfolio") {
            return `
				<section class="workspace-header workspace-mobile-summary-shell" data-mobile-summary-fixed>
					<article class="report-card workspace-article-card workspace-summary-card">
						<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
					</article>
					<article class="report-card workspace-content-card portfolio-summary-content-card">
							<div class="portfolio-summary">
								<div class="portfolio-donut-block">
									<div class="portfolio-donut-orbit is-pending-value" data-workspace-mask="portfolio-donut-start"><div class="portfolio-donut" aria-hidden="true"></div></div>
									<span class="portfolio-donut-arrow icon icon-portfolio-donut-flow" aria-hidden="true"></span>
									<div class="portfolio-donut-orbit is-pending-value" data-workspace-mask="portfolio-donut-end"><div class="portfolio-donut" aria-hidden="true"></div></div>
								</div>
								<div class="portfolio-summary-main">
									<p class="portfolio-total-label">${labels.portfolio_total_return}</p>
									<p class="portfolio-total-value is-pending-value" data-workspace-mask="portfolio-total-return">0000</p>
								</div>
							</div>
						</article>
					<article class="chart-surface">
							<div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
							<div class="chart-wrap is-pending-value" data-workspace-mask="chart-area"></div>
					</article>
				</section>
			`;
        }
        return bootstrap.buildComparePendingWorkspaceMarkup?.({
            currentValues,
            reportHeading,
            chartHeading,
            minimumRequiredTickers: MIN_TICKERS,
        }) || "";
    };

    const removeTickerFromComparePreview = (ticker) => {
        if (state.currentView !== "tickers") return;
        bootstrap.removeTickerFromComparePreview?.({
            ticker,
            state,
            sanitizeTicker,
            minimumRequiredTickers,
        });
    };

    const replaceDomRegion = (currentRegion, nextRegion) => {
        if (!currentRegion || !nextRegion) return;
        currentRegion.replaceChildren(...Array.from(nextRegion.childNodes).map((node) => node.cloneNode(true)));
    };

    const buildWorkspaceRangeNoticeFingerprint = (url = window.location.href) => {
        try {
            const targetUrl = new URL(url, window.location.origin);
            const params = new URLSearchParams(targetUrl.search);
            const tickers = params.getAll("ticker")
                .map((ticker) => String(ticker || "").trim().toUpperCase())
                .filter(Boolean)
                .sort();
            const rangeKeys = [
                "range",
                "period",
                "date",
                "trading_date",
                "exact_trading_date",
                "from",
                "to",
                "exact_start",
                "exact_end",
                "return",
                "extended-hours",
                "extended_hours",
                "include_extended_hours",
                "overnight",
                "include_overnight",
                "price_only",
                "price_return_only",
                "dividends",
                "include_dividends",
            ];
            return [
                `tickers=${tickers.join(",")}`,
                ...rangeKeys.map((key) => `${key}=${params.get(key) || ""}`),
            ].join("|");
        } catch {
            return "";
        }
    };

    const normalizeBannerText = (value) => String(value || "")
        .replace(/\s+/g, " ")
        .trim();

    const syncGlobalNoticeBanners = (doc, targetUrl) => {
        const pageRoot = document.querySelector(".page");
        if (!(pageRoot instanceof HTMLElement) || !doc) return;
        document.querySelectorAll(".notice-floating-banner-global").forEach((node) => node.remove());
        const nextBanners = Array.from(doc.querySelectorAll(".notice-floating-banner-global"));
        if (!nextBanners.length) return;
        const nextRangeFingerprint = buildWorkspaceRangeNoticeFingerprint(targetUrl);
        const isRepeatRange = Boolean(nextRangeFingerprint)
            && nextRangeFingerprint === lastWorkspaceRangeNoticeFingerprint;
        const comparisonStartPrefix = "Comparison starts from ";
        const nextRangeNoticeTexts = new Set();
        const bannersToRender = nextBanners.filter((banner) => {
            const text = normalizeBannerText(banner.textContent);
            if (!text || nextRangeNoticeTexts.has(text)) return false;
            nextRangeNoticeTexts.add(text);
            if (isRepeatRange && (lastWorkspaceRangeNoticeTexts.has(text) || text.includes(comparisonStartPrefix))) {
                return false;
            }
            return true;
        });
        if (nextRangeFingerprint) {
            lastWorkspaceRangeNoticeFingerprint = nextRangeFingerprint;
            lastWorkspaceRangeNoticeTexts = nextRangeNoticeTexts;
        } else {
            lastWorkspaceRangeNoticeTexts = new Set();
        }
        if (!bannersToRender.length) {
            return;
        }
        const anchor = pageRoot.querySelector(".app-shell");
        bannersToRender.forEach((banner) => {
            const clonedBanner = banner.cloneNode(true);
            if (anchor) {
                pageRoot.insertBefore(clonedBanner, anchor);
            } else {
                pageRoot.prepend(clonedBanner);
            }
        });
    };

    const applyComparePendingState = () => {
        bootstrap.applyComparePendingState?.();
    };

    const applyPortfolioPendingState = () => {
        const workspacePanel = document.getElementById("workspace_panel");
        if (!workspacePanel) return;
        delete workspacePanel.dataset.workspacePending;
    };

    const applyBacktestPendingState = () => {
        const workspacePanel = document.getElementById("workspace_panel");
        if (!workspacePanel) return;
        const metricNodes = Array.from(workspacePanel.querySelectorAll('[data-workspace-mask="trade-metric"]'));
        if (!metricNodes.length) return;
        metricNodes.forEach((node) => {
            node.classList.add("is-pending-value");
        });
        workspacePanel.dataset.workspacePending = "1";
    };

    const hydrateWorkspaceModeMain = (workspacePanel, nextWorkspacePanel) => {
        const currentMain = workspacePanel.querySelector(".workspace-mode-main");
        const nextMain = nextWorkspacePanel.querySelector(".workspace-mode-main");
        if (!currentMain || !nextMain) {
            workspacePanel.querySelectorAll("canvas").forEach((canvas) => {
                window.Chart?.getChart?.(canvas)?.destroy();
            });
            workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
            return;
        }
        currentMain.querySelectorAll("canvas").forEach((canvas) => {
            window.Chart?.getChart?.(canvas)?.destroy();
        });
        currentMain.replaceWith(nextMain.cloneNode(true));
    };

    const hydratePriceComparisonWorkspace = (workspacePanel, nextWorkspacePanel) => {
        const currentShell = workspacePanel.querySelector(".price-compare-workspace");
        const nextShell = nextWorkspacePanel.querySelector(".price-compare-workspace");
        if (!(currentShell instanceof HTMLElement) || !(nextShell instanceof HTMLElement)) {
            hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
            return;
        }

        currentShell.className = nextShell.className;
        currentShell.setAttribute(
            "aria-labelledby",
            nextShell.getAttribute("aria-labelledby") || "ticker_comparison_heading",
        );

        const currentTitleCard = currentShell.querySelector(".workspace-mode-title-card");
        const nextTitleCard = nextShell.querySelector(".workspace-mode-title-card");
        if (currentTitleCard && nextTitleCard) {
            replaceDomRegion(currentTitleCard, nextTitleCard);
        }

        const currentControls = currentShell.querySelector(".workspace-mode-controls-surface");
        const nextControls = nextShell.querySelector(".workspace-mode-controls-surface");
        if (currentControls && nextControls) {
            currentControls.setAttribute(
                "aria-labelledby",
                nextControls.getAttribute("aria-labelledby") || "ticker_comparison_heading",
            );
        }

        const nextMetricInput = nextShell.querySelector("[data-comparison-metric-input]:checked");
        const nextMetric = normalizeComparisonMetric(nextMetricInput?.value);
        const currentMetricShell = currentShell.querySelector("[data-comparison-metric-switch]");
        if (currentMetricShell instanceof HTMLElement) {
            const currentMetricInputs = Array.from(
                currentMetricShell.querySelectorAll("[data-comparison-metric-input]"),
            );
            currentMetricInputs.forEach((input) => {
                if (input instanceof HTMLInputElement) {
                    input.checked = normalizeComparisonMetric(input.value) === nextMetric;
                }
            });
            syncSegmentedControlLayout(currentMetricShell, {
                activeValue: nextMetric,
                activeIndex: nextMetric === "market-cap" ? 1 : 0,
            });
        }

        const currentChipsField = currentShell.querySelector("[data-chips-field]");
        const nextChipsField = nextShell.querySelector("[data-chips-field]");
        if (currentChipsField instanceof HTMLElement && nextChipsField instanceof HTMLElement) {
            currentChipsField.hidden = nextChipsField.hidden;
            const currentChipsInput = currentChipsField.querySelector("[data-chips-input]");
            const nextChipsInput = nextChipsField.querySelector("[data-chips-input]");
            if (currentChipsInput instanceof HTMLInputElement && nextChipsInput instanceof HTMLInputElement) {
                currentChipsInput.checked = nextChipsInput.checked;
                currentChipsInput.disabled = nextChipsInput.disabled;
            }
        }

        hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
    };

    const applyPendingWorkspaceMarkup = () => {
        if (state.currentView === "tickers") {
            applyComparePendingState();
            return;
        }
        if (state.currentView === "portfolio") {
            applyPortfolioPendingState();
            return;
        }
		if (state.currentView === "prices") {
			const workspacePanel = document.getElementById("workspace_panel");
			if (workspacePanel) workspacePanel.dataset.workspacePending = "1";
			return;
		}
        if (state.currentView === "backtest" || state.currentView === "dca") {
            applyBacktestPendingState();
            return;
        }
        const workspacePanel = document.getElementById("workspace_panel");
        if (!workspacePanel) return;
        workspacePanel.innerHTML = buildPendingWorkspaceMarkup();
        workspacePanel.dataset.workspacePending = "1";
    };

    const parseStateFromHtmlDocument = (doc) => {
        const stateNode = doc.getElementById("worthward_state");
        if (!stateNode?.textContent) return null;
        try {
            return JSON.parse(stateNode.textContent);
        } catch (_error) {
            return null;
        }
    };

    const collectKnownTickerProfileMap = () => {
        const profileMap = new Map();
        getTickerInputs().forEach((input) => {
            const ticker = sanitizeTicker(input.value || input.dataset.symbol || "");
            if (!ticker) return;
            const control = input.closest(".ticker-input-control");
            const image = control?.querySelector(".ticker-input-logo");
            const logoUrl = input.dataset.logoUrl || image?.getAttribute("src") || "";
            const companyName = input.dataset.companyName || ticker;
            profileMap.set(ticker, {
                ticker,
                company_name: companyName,
                logo_url: logoUrl,
            });
        });
        (state.chart?.profiles || []).forEach((profile) => {
            const ticker = sanitizeTicker(profile?.ticker || "");
            if (!ticker) return;
            const currentProfile = profileMap.get(ticker) || {
                ticker,
                company_name: ticker,
                logo_url: "",
            };
            profileMap.set(ticker, {
                ...currentProfile,
                company_name: currentProfile.company_name || profile?.company_name || ticker,
                logo_url: currentProfile.logo_url || profile?.logo_url || "",
            });
        });
        return profileMap;
    };

    const mergeKnownTickerProfilesIntoState = (nextState) => {
        if (!nextState || !["tickers", "prices", "portfolio"].includes(nextState.currentView)) return nextState;
        if (!nextState.chart) return nextState;
        const profileMap = collectKnownTickerProfileMap();
        if (!profileMap.size) return nextState;
        const existingProfiles = Array.isArray(nextState.chart.profiles) ? nextState.chart.profiles : [];
        const mergedProfiles = existingProfiles.map((profile) => {
            const ticker = sanitizeTicker(profile?.ticker || "");
            if (!ticker) return profile;
            const knownProfile = profileMap.get(ticker);
            if (!knownProfile) return profile;
            return {
                ...profile,
                company_name: profile?.company_name || knownProfile.company_name || ticker,
                logo_url: profile?.logo_url || knownProfile.logo_url || "",
            };
        });
        const mergedTickerSet = new Set(
            mergedProfiles
                .map((profile) => sanitizeTicker(profile?.ticker || ""))
                .filter(Boolean),
        );
        (Array.isArray(nextState.chart.series) ? nextState.chart.series : []).forEach((seriesItem) => {
            const ticker = sanitizeTicker(seriesItem?.ticker || "");
            if (!ticker || mergedTickerSet.has(ticker)) return;
            const knownProfile = profileMap.get(ticker);
            if (!knownProfile) return;
            mergedProfiles.push({
                ticker,
                company_name: knownProfile.company_name || ticker,
                logo_url: knownProfile.logo_url || "",
            });
            mergedTickerSet.add(ticker);
        });
        nextState.chart.profiles = mergedProfiles;
        return nextState;
    };

    const abortActiveWorkspaceHydration = () => {
        if (!activeWorkspaceHydration) return;
        activeWorkspaceHydration.abort();
        activeWorkspaceHydration = null;
    };

    const hydrateWorkspaceFromUrl = async (nextUrl) => {
        if (activeWorkspaceHydration) {
            reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "aborting previous workspace hydration", {
                nextUrl,
                currentPath: window.location.pathname + window.location.search,
            });
        }
        abortActiveWorkspaceHydration();
        const token = ++workspaceHydrationToken;
        const controller = new AbortController();
        activeWorkspaceHydration = controller;
        reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "starting workspace hydration", {
            nextUrl,
            token,
        });
        let response;
        try {
            response = await fetch(nextUrl, {
                headers: {
                    "X-Requested-With": "workspace-hydrate",
                },
                credentials: "same-origin",
                signal: controller.signal,
            });
        } catch (error) {
            reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "workspace hydration fetch failed", {
                nextUrl,
                token,
                errorName: error?.name || "",
                errorMessage: error?.message || "",
                aborted: controller.signal.aborted,
            });
            throw error;
        }
        reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "workspace hydration response received", {
            nextUrl,
            token,
            status: response.status,
            aborted: controller.signal.aborted,
        });
        if (!response.ok) throw new Error(`Workspace refresh failed: ${response.status}`);
        const html = await response.text();
        if (controller.signal.aborted || token !== workspaceHydrationToken) return false;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const nextWorkspacePanel = doc.getElementById("workspace_panel");
        const workspacePanel = document.getElementById("workspace_panel");
        if (!nextWorkspacePanel || !workspacePanel) throw new Error("Workspace panel missing from response.");
        syncGlobalNoticeBanners(doc, nextUrl);
        if (state.currentView === "tickers") {
            const hydratedCompareWorkspace = bootstrap.hydrateCompareWorkspace?.({
                doc,
                replaceDomRegion,
            });
            if (!hydratedCompareWorkspace) {
                workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
            }
        } else if (state.currentView === "portfolio") {
            const currentSummaryRegion = document.getElementById("portfolio_summary_region");
            const nextSummaryRegion = doc.getElementById("portfolio_summary_region");
            const currentChartRegion = document.getElementById("portfolio_chart_region");
            const nextChartRegion = doc.getElementById("portfolio_chart_region");
            if (!currentSummaryRegion || !nextSummaryRegion || !currentChartRegion || !nextChartRegion) {
                workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
            } else {
                replaceDomRegion(currentSummaryRegion, nextSummaryRegion);
                replaceDomRegion(currentChartRegion, nextChartRegion);
                workspacePanel.querySelectorAll(".is-pending-value").forEach((node) => node.classList.remove("is-pending-value"));
            }
        } else if (state.currentView === "backtest") {
            hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
        } else if (state.currentView === "prices") {
            hydratePriceComparisonWorkspace(workspacePanel, nextWorkspacePanel);
        } else if (state.currentView === "dca") {
            hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
        } else {
            workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
        }
        delete workspacePanel.dataset.workspacePending;
        const nextState = mergeKnownTickerProfilesIntoState(parseStateFromHtmlDocument(doc));
        if (nextState) {
            window.WORTHWARD_APP = nextState;
            Object.assign(state, nextState);
            if (state.currentView === "prices") {
                const nextMaxTickers = Number.parseInt(nextState.constraints?.maxTickers, 10);
                MAX_TICKERS = Number.isFinite(nextMaxTickers)
                    ? Math.max(MIN_TICKERS, nextMaxTickers)
                    : PRICE_COMPARISON_MAX_TICKERS;
                updateAddButtonState();
            }
        }
        document.title = doc.title || document.title;
        window.history.replaceState({}, "", nextUrl);
        initializeWorkspaceEnhancements();
        scheduleDockPosition();
        scheduleMobilePageBottomPaddingSync();
        if (activeWorkspaceHydration === controller) activeWorkspaceHydration = null;
        return true;
    };

    const readViewMemory = () => {
        try {
            const raw = preferenceStorage.session.getItem(VIEW_MEMORY_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_error) {
            return {};
        }
    };

    const writeViewMemory = (nextMemory) => {
        try {
            preferenceStorage.session.setItem(VIEW_MEMORY_KEY, JSON.stringify(nextMemory));
        } catch (_error) {
        }
    };

    const sanitizeRememberedUrl = (url) => {
        try {
            const parsed = new URL(url, window.location.origin);
            TRANSIENT_VIEW_QUERY_KEYS.forEach((key) => {
                parsed.searchParams.delete(key);
            });
            const normalizedSearch = parsed.searchParams.toString();
            return `${parsed.pathname}${normalizedSearch ? `?${normalizedSearch}` : ""}${parsed.hash || ""}`;
        } catch (_error) {
            return url;
        }
    };

    const rememberCurrentViewUrl = (url = window.location.pathname + window.location.search) => {
        if (!state.currentView) return;
        const memory = readViewMemory();
        const sanitizedUrl = sanitizeRememberedUrl(url);
        memory[state.currentView] = sanitizedUrl;
        if (WORKSPACE_VIEWS.has(state.currentView)) {
            memory.workspace = sanitizedUrl;
        }
        writeViewMemory(memory);
    };

    const resolveWorkspaceModeMemoryUrl = (link, fallbackUrl) => {
        if (!(link instanceof HTMLAnchorElement) || !link.closest(".workspace-mode-nav")) {
            return fallbackUrl;
        }
        const targetView = resolveViewFromUrl(fallbackUrl);
        const comparisonViews = new Set(["tickers", "prices"]);
        if (!comparisonViews.has(state.currentView) || !comparisonViews.has(targetView)) {
            return fallbackUrl;
        }
        const rememberedUrl = readViewMemory()[targetView];
        if (rememberedUrl && resolveViewFromUrl(rememberedUrl) === targetView) {
            return rememberedUrl;
        }
        try {
            const target = new URL(fallbackUrl, window.location.origin);
            const current = new URL(window.location.href);
            target.search = current.search;
            target.hash = "";
            return sanitizeRememberedUrl(`${target.pathname}${target.search}`);
        } catch (_error) {
            return fallbackUrl;
        }
    };

    const attachDockMemory = () => {
        const dockGroupByIndex = ["workspace", "trade", "settings"];
        $$(".sidebar-dock-item").forEach((link, index) => {
            const targetDockGroup = dockGroupByIndex[index];
            if (!targetDockGroup || link.dataset.boundDockMemory === "1") return;
            link.dataset.boundDockMemory = "1";
            link.addEventListener("click", (event) => {
                rememberCurrentViewUrl();
                const memory = readViewMemory();
                const rememberedUrl = targetDockGroup === "workspace"
                    ? (memory.workspace || memory.backtest || memory.portfolio || memory.tickers)
                    : memory[targetDockGroup];
                const fallbackUrl = link.getAttribute("href") || "";
                event.preventDefault();
                const rememberedView = rememberedUrl ? resolveViewFromUrl(rememberedUrl) : null;
                const rememberedDockGroup = rememberedView ? resolveDockGroupFromView(rememberedView) : null;
                const nextUrl = rememberedDockGroup === targetDockGroup ? rememberedUrl : fallbackUrl;
                if (!nextUrl) return;
                const currentDockGroup = resolveDockGroupFromView(state.currentView);
                if (targetDockGroup === currentDockGroup && nextUrl === (window.location.pathname + window.location.search)) {
                    return;
                }
                beginOptimisticPageNavigation(nextUrl, {link, targetDockGroup});
            });
        });
    };

    const shouldHandleOptimisticLinkClick = (event, link) => {
        if (event.defaultPrevented || event.button !== 0) return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
        if (!(link instanceof HTMLAnchorElement)) return false;
        if (link.closest(".sidebar-dock")) return false;
        if (link.hasAttribute("download")) return false;
        const target = (link.getAttribute("target") || "").toLowerCase();
        if (target && target !== "_self") return false;
        const href = link.getAttribute("href");
        if (!href || href.startsWith("#")) return false;
        let url;
        try {
            url = new URL(href, window.location.href);
        } catch (_error) {
            return false;
        }
        if (url.origin !== window.location.origin) return false;
        if (!resolveViewFromUrl(url.href)) return false;
        const currentUrl = new URL(window.location.href);
        if (url.pathname === currentUrl.pathname && url.search === currentUrl.search && url.hash) return false;
        if (url.pathname === currentUrl.pathname && url.search === currentUrl.search) return false;
        return true;
    };

    const attachOptimisticInternalNavigation = () => {
        if (document.body.dataset.optimisticNavigationBound === "1") return;
        document.body.dataset.optimisticNavigationBound = "1";
        document.addEventListener("click", (event) => {
            const link = event.target?.closest?.("a[href]");
            if (!shouldHandleOptimisticLinkClick(event, link)) return;
            const fallbackUrl = link.getAttribute("href") || "";
            rememberCurrentViewUrl();
            const nextUrl = resolveWorkspaceModeMemoryUrl(link, fallbackUrl);
            const normalizedNextUrl = normalizeNavigationUrl(nextUrl);
            if (!normalizedNextUrl) return;
            event.preventDefault();
            beginOptimisticPageNavigation(normalizedNextUrl, {link});
        });
    };

    const isTickerValidationPending = () => getTickerInputs().some((input) => input.dataset.validationPending === "1");

    const setTickerValidationPending = (input, isPending) => {
        if (!input) return;
        input.dataset.validationPending = isPending ? "1" : "";
        input.classList.toggle("is-pending", isPending);
    };
    const syncTickerIdentityState = (input, nextTicker = sanitizeTicker(input?.value?.trim?.() || "")) => {
        if (!input) return "";
        const currentTicker = sanitizeTicker(nextTicker);
        const selectedTicker = sanitizeTicker(input.dataset.symbol || "");
        const validatedTicker = sanitizeTicker(input.dataset.validatedTicker || "");
        const pendingTicker = sanitizeTicker(input.dataset.validationTicker || "");
        if (!currentTicker || (selectedTicker && selectedTicker !== currentTicker)) {
            input.dataset.logoUrl = "";
            input.dataset.symbol = "";
            input.dataset.companyName = "";
        }
        if (!currentTicker || (validatedTicker && validatedTicker !== currentTicker)) {
            input.dataset.validatedTicker = "";
            input.dataset.validatedKnown = "";
        }
        if (!currentTicker || (pendingTicker && pendingTicker !== currentTicker)) {
            input.dataset.validationTicker = "";
        }
        if (!currentTicker) {
            input.dataset.unknown = "";
            setTickerValidationPending(input, false);
        }
        return currentTicker;
    };

    const rememberValidatedTicker = (input, ticker, isKnown) => {
        if (!input) return;
        input.dataset.validatedTicker = ticker || "";
        input.dataset.validatedKnown = isKnown ? "1" : "0";
        if (ticker) tickerValidationCache.set(ticker, isKnown);
    };

    const seedTickerValidationState = () => {
        if (!hasInitialResult) return;
        getTickerInputs().forEach((input) => {
            if (!(input instanceof HTMLInputElement)) return;
            const value = sanitizeTicker(input.value.trim());
            if (!value || !tickerPattern.test(value) || input.dataset.unknown === "1") return;
            rememberValidatedTicker(input, value, true);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
        });
    };

    const validateTickerExistence = async (input, {preferFresh = false} = {}) => {
        if (!input) return false;
        const value = syncTickerIdentityState(input, sanitizeTicker(input.value.trim()));
        input.value = value;
        validateTickerInput(input);
        if (!value) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return false;
        }
        if (!tickerPattern.test(value)) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return false;
        }
        const counts = new Map();
        getFilledTickers().forEach((ticker) => counts.set(ticker, (counts.get(ticker) || 0) + 1));
        if ((counts.get(value) || 0) > 1) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return false;
        }

        if (!preferFresh && input.dataset.validatedTicker === value) {
            const known = input.dataset.validatedKnown !== "0";
            input.dataset.unknown = known ? "" : "1";
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return known;
        }

        if (!preferFresh && tickerValidationCache.has(value)) {
            const isKnown = Boolean(tickerValidationCache.get(value));
            input.dataset.unknown = isKnown ? "" : "1";
            rememberValidatedTicker(input, value, isKnown);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return isKnown;
        }

        setTickerValidationPending(input, true);
        input.dataset.validationTicker = value;
        try {
            const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(value)}&limit=5`);
            if (!response.ok) throw new Error(`Ticker lookup failed: ${response.status}`);
            const payload = await response.json();
            const isKnown = Boolean(payload.find((item) => tickersExplicitlyEquivalent(item?.symbol || "", value)));
            if (input.dataset.validationTicker === value) {
                input.dataset.unknown = isKnown ? "" : "1";
                if (isKnown) {
                    applyExactTickerMatch(input, payload, value);
                } else {
                    rememberValidatedTicker(input, value, false);
                    setTickerValidationPending(input, false);
                    validateTickerInput(input);
                }
            }
            return isKnown;
        } catch (_error) {
            if (input.dataset.validationTicker === value) {
                rememberValidatedTicker(input, value, input.dataset.unknown !== "1");
                setTickerValidationPending(input, false);
                validateTickerInput(input);
            }
            return input.dataset.unknown !== "1";
        }
    };

    const ensureTickerValidityBeforeSubmit = async () => {
        const inputs = getTickerInputs();
        const results = await Promise.all(inputs.map((input) => validateTickerExistence(input, {preferFresh: false})));
        validateAllTickerInputs();
        return results.every((item, index) => {
            const input = inputs[index];
            if (!sanitizeTicker(input.value.trim())) return !input.required;
            return item && input.checkValidity() && input.dataset.unknown !== "1";
        });
    };

    const syncTickerClearButton = (input) => {
        const clearButton = input?.parentElement?.querySelector(".ticker-clear");
        if (!clearButton || !input) return;
        clearButton.classList.toggle("is-visible", Boolean(input.value.trim()));
    };
    const buildMarketStoreLogoUrls = (ticker) => {
        const normalizedTicker = sanitizeTicker(ticker);
        if (!normalizedTicker) return [];
        const encodedTicker = encodeURIComponent(normalizedTicker);
        return [
            `/market-store/logos/${encodedTicker}.png`,
            `/market-store/logos/${encodedTicker}.svg`,
        ];
    };
    const normalizeLogoUrlList = (logoUrl) => {
        const values = Array.isArray(logoUrl) ? logoUrl : [logoUrl];
        return Array.from(new Set(values
            .map((value) => String(value || "").trim())
            .filter(Boolean)));
    };

    const setTickerLogoVisibility = (logo, placeholder, isLoaded) => {
        if (logo instanceof HTMLImageElement) {
            logo.hidden = !isLoaded;
            logo.dataset.loaded = isLoaded ? "1" : "0";
        }
        if (placeholder) placeholder.hidden = isLoaded;
    };

    const syncTickerLogoAsset = (logo, placeholder, logoUrl, altText = "") => {
        const normalizedUrls = normalizeLogoUrlList(logoUrl);
        if (!(logo instanceof HTMLImageElement)) {
            if (placeholder) placeholder.hidden = normalizedUrls.length > 0;
            return;
        }
        logo.onload = null;
        logo.onerror = null;
        if (!normalizedUrls.length) {
            delete logo.dataset.requestedSrc;
            logo.removeAttribute("src");
            logo.alt = "";
            setTickerLogoVisibility(logo, placeholder, false);
            return;
        }
        logo.alt = altText;
        logo.loading = "eager";
        const tryLoadAtIndex = (index) => {
            const nextUrl = normalizedUrls[index];
            if (!nextUrl) {
                delete logo.dataset.requestedSrc;
                logo.removeAttribute("src");
                setTickerLogoVisibility(logo, placeholder, false);
                return;
            }
            logo.dataset.requestedSrc = nextUrl;
            setTickerLogoVisibility(logo, placeholder, false);
            const finalize = (isLoaded) => {
                if (logo.dataset.requestedSrc !== nextUrl) return;
                if (!isLoaded) {
                    tryLoadAtIndex(index + 1);
                    return;
                }
                setTickerLogoVisibility(logo, placeholder, true);
            };
            logo.onload = () => finalize(true);
            logo.onerror = () => finalize(false);
            if (logo.getAttribute("src") !== nextUrl) {
                logo.src = nextUrl;
            }
            if (logo.complete) {
                finalize(Boolean(logo.naturalWidth && logo.naturalHeight));
            }
        };
        tryLoadAtIndex(0);
    };

    const syncTickerInputDecoration = (input, suggestion = null) => {
        const control = input?.closest(".ticker-input-control");
        if (!control || !input) return;
        const logo = control.querySelector(".ticker-input-logo");
        const placeholder = control.querySelector(".ticker-logo-placeholder");
        const value = input.value.trim();
        const hasTickerLikeValue = Boolean(value);
        const selectedTicker = sanitizeTicker(input.dataset.symbol || "");
        const validatedTicker = sanitizeTicker(input.dataset.validatedTicker || "");
        const suggestedTicker = sanitizeTicker(suggestion?.symbol || "");
        const tickerValue = suggestedTicker || sanitizeTicker(value) || selectedTicker;
		if (placeholder) {
			placeholder.textContent = tickerValue ? tickerValue.slice(0, 2) : "";
			placeholder.dataset.ticker = tickerValue;
		}
        const profileLogoUrl = state.chart?.profiles?.find((item) => item.ticker === tickerValue)?.logo_url || "";
        const storedLogoUrl = selectedTicker && selectedTicker === tickerValue ? (input.dataset.logoUrl || "") : "";
        const existingLogoUrl = logo instanceof HTMLImageElement
            ? (sanitizeTicker((logo.alt || "").replace(/\s+logo$/i, "")) === tickerValue
                ? (logo.dataset.requestedSrc || logo.getAttribute("src") || "")
                : "")
            : "";
        const hasConfirmedTicker = Boolean(
            (suggestedTicker && suggestedTicker === tickerValue)
            || (selectedTicker && selectedTicker === tickerValue)
            || (validatedTicker && validatedTicker === tickerValue)
            || existingLogoUrl
            || profileLogoUrl
        );
        const fallbackLogoUrls = hasConfirmedTicker ? buildMarketStoreLogoUrls(tickerValue) : [];
        const logoUrls = normalizeLogoUrlList([
            suggestion?.logo_url,
            storedLogoUrl,
            profileLogoUrl,
            existingLogoUrl,
			...fallbackLogoUrls,
        ]);
        control.classList.toggle("has-value", hasTickerLikeValue);
        control.classList.toggle("has-logo", logoUrls.length > 0);
        syncTickerLogoAsset(logo, placeholder, logoUrls, logoUrls.length ? `${tickerValue} logo` : "");
        if (suggestion) {
            input.dataset.logoUrl = suggestion.logo_url || profileLogoUrl || fallbackLogoUrls[0] || "";
            input.dataset.symbol = suggestion.symbol || tickerValue;
            input.dataset.companyName = suggestion.name || suggestion.symbol || "";
        } else if (hasTickerLikeValue && selectedTicker && selectedTicker === tickerValue && !input.dataset.logoUrl && logoUrls.length) {
            input.dataset.logoUrl = logoUrls[0];
        }
        if (!hasTickerLikeValue) {
            input.dataset.logoUrl = "";
            input.dataset.symbol = "";
            input.dataset.companyName = "";
        }
    };

    const applyExactTickerMatch = (input, items, ticker) => {
        if (!input || !Array.isArray(items) || !ticker) return null;
        const exactItem = items.find((item) => tickersExplicitlyEquivalent(item?.symbol || "", ticker)) || null;
        if (!exactItem) return null;
        const exactSymbol = sanitizeTicker(exactItem.symbol || ticker);
        if (exactSymbol) input.value = exactSymbol;
        input.dataset.unknown = "";
        rememberValidatedTicker(input, exactSymbol || ticker, true);
        setTickerValidationPending(input, false);
        syncTickerInputDecoration(input, exactItem);
        validateTickerInput(input);
        return exactItem;
    };

    const hidePortfolioWeightTooltips = () => {
        getWeightFields().forEach((entry) => {
            if (!entry.tooltip) return;
            entry.tooltip.hidden = true;
            entry.tooltip.textContent = "";
        });
    };

    const showPortfolioWeightTooltip = (entry, message) => {
        if (!entry?.tooltip) return;
        entry.tooltip.textContent = message;
        entry.tooltip.hidden = false;
        window.setTimeout(() => {
            if (entry.tooltip) entry.tooltip.hidden = true;
        }, 2400);
    };

    const nextPortfolioTouchStamp = () => {
        portfolioWeightState.clock += 1;
        return portfolioWeightState.clock;
    };

    const markPortfolioWeightTouched = (index) => {
        portfolioWeightState.touchedAtByIndex[index] = nextPortfolioTouchStamp();
    };

    const dropPortfolioWeightTouch = (index) => {
        delete portfolioWeightState.touchedAtByIndex[index];
    };

    const getPortfolioWeightTouchStamp = (index) => portfolioWeightState.touchedAtByIndex[index] || 0;

    const reindexPortfolioWeightState = () => {
        const nextTouchedAtByIndex = {};
        getTickerFields().forEach((field, offset) => {
            const previousIndex = Number.parseInt(field.dataset.index || String(offset + 1), 10) - 1;
            const nextIndex = offset;
            const previousStamp = portfolioWeightState.touchedAtByIndex[previousIndex];
            if (previousStamp) nextTouchedAtByIndex[nextIndex] = previousStamp;
        });
        portfolioWeightState.touchedAtByIndex = nextTouchedAtByIndex;
    };

    const ensurePortfolioWeightTouches = () => {
        if (!isPortfolioView) return;
        const filledEntries = getFilledWeightEntries();
        if (filledEntries.length && Object.keys(portfolioWeightState.touchedAtByIndex).length === 0) {
            filledEntries.forEach((entry, order) => {
                portfolioWeightState.clock += 1;
                portfolioWeightState.touchedAtByIndex[entry.index] = order === filledEntries.length - 1 ? 1 : portfolioWeightState.clock + 1;
            });
        }
        filledEntries.forEach((entry) => {
            if (!getPortfolioWeightTouchStamp(entry.index)) {
                markPortfolioWeightTouched(entry.index);
            }
        });
        const activeIndexes = new Set(filledEntries.map((entry) => entry.index));
        Object.keys(portfolioWeightState.touchedAtByIndex).forEach((key) => {
            const index = Number.parseInt(key, 10);
            if (!activeIndexes.has(index)) dropPortfolioWeightTouch(index);
        });
    };

    const updateAddButtonState = () => {
        const wrapper = $("#ticker_add_wrapper");
        if (!wrapper) return;
        wrapper.hidden = getTickerFields().length >= MAX_TICKERS;
    };

    const reindexTickerFields = () => {
        reindexPortfolioWeightState();
        getTickerFields().forEach((field, offset) => {
            const index = offset + 1;
            field.dataset.index = String(index);
            const label = field.querySelector("label");
            const input = field.querySelector("[data-ticker-input]");
            const suggestions = field.querySelector(".suggestions");
            if (label) {
                label.setAttribute("for", `ticker_${index}`);
                label.textContent = isBacktestView && getMinimumRequiredTickers() > 1
                    ? `${labels.backtest_ticker} ${index}`
                    : (isBacktestView || isDcaView) ? labels.backtest_ticker : `Ticker ${index}`;
            }
            if (input) {
                input.id = `ticker_${index}`;
                input.name = "ticker";
                input.required = index <= getMinimumRequiredTickers();
                input.placeholder = "";
                syncTickerClearButton(input);
                syncTickerInputDecoration(input);
            }
            const weightInput = field.querySelector(".portfolio-weight-input");
            const weightSlider = field.querySelector(".portfolio-weight-slider");
            const shareInput = field.querySelector(".portfolio-share-input");
            if (weightInput && weightSlider) {
                weightInput.id = `weight_${index}`;
                weightInput.name = "weight";
                weightSlider.dataset.index = String(index);
            }
            if (shareInput) {
                shareInput.id = `shares_${index}`;
                shareInput.name = "shares";
            }
            if (suggestions) suggestions.id = `ticker_${index}_suggestions`;
            const removeButton = field.querySelector(".ticker-remove");
            if (removeButton) {
                removeButton.classList.toggle("is-placeholder", index <= getMinimumRequiredTickers());
                removeButton.tabIndex = index <= getMinimumRequiredTickers() ? -1 : 0;
                removeButton.setAttribute("aria-hidden", index <= getMinimumRequiredTickers() ? "true" : "false");
            }
        });
        updateAddButtonState();
    };

    const tickerOrderIdentity = (value) => {
        const ticker = sanitizeTicker(value || "");
        return ["SKHY", "SKHYV"].includes(ticker) ? "SKHY" : ticker;
    };

    const animateTickerFieldOrder = (fields, previousTopByField) => {
        fields.forEach((field) => {
            const previousTop = previousTopByField.get(field);
            const nextTop = field.getBoundingClientRect().top;
            const deltaY = Number(previousTop) - nextTop;
            if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
            field.getAnimations?.().forEach((animation) => {
                if (animation.id === "ticker-field-order") animation.cancel();
            });
            const animation = window.WorthwardMotion?.animate?.(
                field,
                [
                    {
                        transform: `translate3d(0, ${deltaY}px, 0) scale(0.985)`,
                        filter: "drop-shadow(0 14px 22px rgba(15, 23, 42, 0.12))",
                    },
                    {
                        transform: "translate3d(0, 0, 0) scale(1)",
                        filter: "drop-shadow(0 0 0 rgba(15, 23, 42, 0))",
                    },
                ],
                {
                    id: "ticker-field-order",
                    duration: window.WorthwardMotion?.durations?.emphasized ?? 420,
                    easing: window.WorthwardMotion?.easingTokens?.emphasized,
                },
            );
            if (!animation) return;
            field.dataset.orderMotion = "y-z";
            animation.finished.catch(() => {}).finally(() => {
                if (field.dataset.orderMotion === "y-z") delete field.dataset.orderMotion;
            });
        });
    };

    bootstrap.reorderTickerFieldsByTicker = (tickerOrder = []) => {
        if (state.currentView !== "prices") return [];
        const container = document.getElementById("ticker_fields");
        if (!(container instanceof HTMLElement)) return [];
        const fields = getTickerFields();
        const previousTopByField = new Map(
            fields.map((field) => [field, field.getBoundingClientRect().top]),
        );
        const fieldQueues = new Map();
        fields.forEach((field) => {
            const input = field.querySelector("[data-ticker-input]");
            const identity = tickerOrderIdentity(input?.value || "");
            if (!identity) return;
            const queue = fieldQueues.get(identity) || [];
            queue.push(field);
            fieldQueues.set(identity, queue);
        });
        const orderedFields = [];
        tickerOrder.forEach((ticker) => {
            const queue = fieldQueues.get(tickerOrderIdentity(ticker));
            const field = queue?.shift();
            if (field && !orderedFields.includes(field)) orderedFields.push(field);
        });
        fields.forEach((field) => {
            if (!orderedFields.includes(field)) orderedFields.push(field);
        });
        orderedFields.forEach((field) => container.appendChild(field));
        reindexTickerFields();
        animateTickerFieldOrder(orderedFields, previousTopByField);

        const orderedTickers = getFilledTickers();
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete("ticker");
        orderedTickers.forEach((ticker) => nextUrl.searchParams.append("ticker", ticker));
        const relativeUrl = `${nextUrl.pathname}?${nextUrl.searchParams.toString()}${nextUrl.hash}`;
        window.history.replaceState(window.history.state, "", relativeUrl);
        rememberCurrentViewUrl(relativeUrl);
        window.dispatchEvent(new CustomEvent("worthward:ticker-order-change", {
            detail: {tickers: orderedTickers},
        }));
        return orderedTickers;
    };

    const syncPortfolioWeightDisabledState = () => {
        if (!isPortfolioView) return;
        getWeightFields().forEach(({field, tickerInput, number, slider, shares}) => {
            const isFilled = Boolean(sanitizeTicker(tickerInput.value.trim()));
            number.disabled = !isFilled;
            slider.disabled = !isFilled;
            if (shares) shares.disabled = !isFilled;
            field.querySelectorAll(".portfolio-share-stepper-button").forEach((button) => {
                button.disabled = !isFilled;
            });
            if (!isFilled) {
                number.value = "0";
                slider.value = "0";
                if (shares) shares.value = "0";
            }
        });
    };

    const buildDefaultWeights = (count) => {
        if (count <= 0) return [];
        const base = Math.floor(100 / count);
        const remainder = 100 % count;
        return Array.from({length: count}, (_item, index) => base + (index < remainder ? 1 : 0));
    };

    const getFilledWeightEntries = () => getWeightFields()
        .map((item, index) => ({...item, index, ticker: sanitizeTicker(item.tickerInput.value.trim())}))
        .filter((item) => item.ticker);

    const syncPortfolioWeightPair = (entry, value) => {
        const normalized = Math.min(100, Math.max(0, Number.parseInt(String(value || 0), 10) || 0));
        entry.number.value = String(normalized);
        entry.slider.value = String(normalized);
    };

    const syncPortfolioShareInput = (entry, value) => {
        if (!entry?.shares) return;
        const normalized = Math.max(0, Number.parseInt(String(value || 0), 10) || 0);
        entry.shares.value = String(normalized);
    };

    const resolveOrderedPortfolioPeer = (referenceIndex, filledEntries, {preferPrevious = true} = {}) => {
        const previousCandidates = filledEntries.filter((entry) => entry.index < referenceIndex);
        const nextCandidates = filledEntries.filter((entry) => entry.index > referenceIndex);
        if (preferPrevious && previousCandidates.length) {
            return previousCandidates[previousCandidates.length - 1];
        }
        if (!preferPrevious && nextCandidates.length) {
            return nextCandidates[0];
        }
        return preferPrevious
            ? (nextCandidates[0] || null)
            : (previousCandidates[previousCandidates.length - 1] || null);
    };

    const resolvePassivePortfolioEntry = (changedIndex, filledEntries) => (
        resolveOrderedPortfolioPeer(changedIndex, filledEntries, {preferPrevious: true})
    );

    const computeActiveWeightBounds = (changedIndex, filledEntries) => {
        const passiveEntry = resolvePassivePortfolioEntry(changedIndex, filledEntries);
        if (!passiveEntry) {
            return {min: 100, max: 100, passiveEntry: null};
        }
        const fixedOtherTotal = filledEntries
            .filter((entry) => entry.index !== changedIndex && entry.index !== passiveEntry.index)
            .reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
        return {
            min: Math.max(0, 100 - fixedOtherTotal - 100),
            max: Math.min(100, 100 - fixedOtherTotal),
            passiveEntry,
        };
    };

    const syncPortfolioWeightBounds = () => {
        if (!isPortfolioView) return;
        ensurePortfolioWeightTouches();
        const filledEntries = getFilledWeightEntries();
        const filledIndexSet = new Set(filledEntries.map((entry) => entry.index));
        getWeightFields().forEach((entry) => {
            if (!filledIndexSet.has(entry.index)) {
                entry.number.min = "0";
                entry.number.max = "100";
                entry.slider.min = "0";
                entry.slider.max = "100";
                return;
            }
            const bounds = computeActiveWeightBounds(entry.index, filledEntries);
            entry.number.min = String(bounds.min);
            entry.number.max = String(bounds.max);
            entry.slider.min = String(bounds.min);
            entry.slider.max = String(bounds.max);
        });
    };

    const rebalancePortfolioWeights = (changedIndex) => {
        if (!isPortfolioView) return;
        ensurePortfolioWeightTouches();
        const filledEntries = getFilledWeightEntries();
        if (!filledEntries.length) return;
        const activeEntry = filledEntries.find((entry) => entry.index === changedIndex);
        if (!activeEntry) return;
        hidePortfolioWeightTooltips();
        const bounds = computeActiveWeightBounds(changedIndex, filledEntries);
        const passiveEntry = bounds.passiveEntry;
        if (!passiveEntry) {
            syncPortfolioWeightPair(activeEntry, 100);
            markPortfolioWeightTouched(changedIndex);
            syncPortfolioWeightBounds();
            return;
        }
        const desiredActive = Number.parseInt(activeEntry.number.value, 10) || 0;
        let nextActive = desiredActive;
        let shouldWarn = false;
        if (desiredActive > bounds.max) {
            nextActive = bounds.max;
            shouldWarn = true;
        }
        if (desiredActive < bounds.min) {
            nextActive = bounds.min;
            shouldWarn = true;
        }
        const fixedOtherTotal = filledEntries
            .filter((entry) => entry.index !== changedIndex && entry.index !== passiveEntry.index)
            .reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
        const nextPassive = Math.max(0, Math.min(100, 100 - fixedOtherTotal - nextActive));
        syncPortfolioWeightPair(activeEntry, nextActive);
        syncPortfolioWeightPair(passiveEntry, nextPassive);
        if (shouldWarn) {
            showPortfolioWeightTooltip(
                activeEntry,
                `${passiveEntry.ticker} stayed paired by ticker order, so ${activeEntry.ticker} was limited to keep the total at 100%.`,
            );
        }
        markPortfolioWeightTouched(changedIndex);
        syncPortfolioWeightBounds();
    };

    const rebalancePortfolioWeightsAfterRemoval = (removedWeight = 0, removedIndex = -1) => {
        if (!isPortfolioView) return;
        ensurePortfolioWeightTouches();
        const filledEntries = getFilledWeightEntries();
        if (!filledEntries.length) return;
        if (filledEntries.length === 1) {
            syncPortfolioWeightPair(filledEntries[0], 100);
            markPortfolioWeightTouched(filledEntries[0].index);
            syncPortfolioWeightBounds();
            return;
        }
        const currentTotal = filledEntries.reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
        const deficit = Math.max(0, 100 - currentTotal);
        const targetAdjustment = deficit || Math.max(0, Number.parseInt(String(removedWeight || 0), 10) || 0);
        if (targetAdjustment <= 0) {
            syncPortfolioWeightBounds();
            return;
        }
        const passiveEntry = filledEntries[Math.max(0, Math.min(removedIndex - 1, filledEntries.length - 1))] || filledEntries[0];
        const nextValue = (Number.parseInt(passiveEntry.number.value, 10) || 0) + targetAdjustment;
        syncPortfolioWeightPair(passiveEntry, Math.min(100, nextValue));
        markPortfolioWeightTouched(passiveEntry.index);
        syncPortfolioWeightBounds();
    };

    const dispatchPortfolioPreviewUpdate = () => {
        if (!isPortfolioView) return;
        window.dispatchEvent(new CustomEvent("worthward:portfolio-preview", {
            detail: {
                entries: getFilledWeightEntries().map((entry) => ({
                    index: entry.index,
                    ticker: entry.ticker,
                    weight: Number.parseInt(entry.number.value, 10) || 0,
                })),
            },
        }));
    };

    const validatePortfolioWeightInputs = () => {
        if (!isPortfolioView) return true;
        let isValid = true;
        const shareMode = isPortfolioShareMode();
        getWeightFields().forEach((entry) => {
            const {tickerInput, number, shares} = entry;
            const ticker = sanitizeTicker(tickerInput.value.trim());
            if (shareMode) {
                const shareCount = Number.parseInt(shares?.value || "0", 10) || 0;
                if (ticker && shareCount <= 0) {
                    shares?.classList.add("is-invalid");
                    if (!entry.tooltip?.textContent) {
                        showPortfolioWeightTooltip(entry, "Each selected ticker must have at least 1 share.");
                    }
                    isValid = false;
                    return;
                }
                shares?.classList.remove("is-invalid");
                number.classList.remove("is-invalid");
                return;
            }
            const weight = Number.parseInt(number.value, 10) || 0;
            if (ticker && weight <= 0) {
                number.classList.add("is-invalid");
                if (!entry.tooltip?.textContent) {
                    showPortfolioWeightTooltip(entry, "Each selected ticker must have a weight above 0%.");
                }
                isValid = false;
                return;
            }
            number.classList.remove("is-invalid");
            shares?.classList.remove("is-invalid");
        });
        return isValid;
    };

    const restoreRetainedPortfolioWeight = (tickerInput) => {
        if (!isPortfolioView || !tickerInput) return;
        const field = tickerInput.closest(".ticker-field");
        const number = field?.querySelector(".portfolio-weight-input");
        const slider = field?.querySelector(".portfolio-weight-slider");
        const retainedWeight = Number.parseInt(tickerInput.dataset.retainedWeight || "", 10);
        if (!number || !slider) return;
        if (!sanitizeTicker(tickerInput.value.trim())) return;
        if (!Number.isFinite(retainedWeight) || retainedWeight <= 0) return;
        if ((Number.parseInt(number.value, 10) || 0) > 0) return;
        number.value = String(retainedWeight);
        slider.value = String(retainedWeight);
        delete tickerInput.dataset.retainedWeight;
    };

    const handlePortfolioTickerValueChange = (tickerInput) => {
        if (!isPortfolioView || !tickerInput) return;
        const field = tickerInput.closest(".ticker-field");
        const number = field?.querySelector(".portfolio-weight-input");
        const slider = field?.querySelector(".portfolio-weight-slider");
        const entry = getWeightFields().find((item) => item.tickerInput === tickerInput);
        if (!number || !slider || !entry) return;

        const previousTicker = tickerInput.dataset.lastTicker || "";
        const ticker = sanitizeTicker(tickerInput.value.trim());
        if (!ticker && previousTicker) {
            const currentWeight = Number.parseInt(number.value, 10) || 0;
            if (currentWeight > 0) {
                tickerInput.dataset.retainedWeight = String(currentWeight);
            }
        }
        if (ticker && !previousTicker) {
            restoreRetainedPortfolioWeight(tickerInput);
        }

        syncPortfolioWeightDisabledState();
        if (ticker && !getPortfolioWeightTouchStamp(entry.index)) {
            markPortfolioWeightTouched(entry.index);
        }
        if (!ticker) {
            dropPortfolioWeightTouch(entry.index);
        }

        const filledEntries = getFilledWeightEntries();
        if (filledEntries.length && filledEntries.every((item) => (Number.parseInt(item.number.value, 10) || 0) === 0)) {
            const defaults = buildDefaultWeights(filledEntries.length);
            filledEntries.forEach((item, itemIndex) => syncPortfolioWeightPair(item, defaults[itemIndex] || 0));
        }

        syncPortfolioWeightBounds();
        dispatchPortfolioPreviewUpdate();
        validatePortfolioWeightInputs();
        tickerInput.dataset.lastTicker = ticker;
    };

    const attachPortfolioWeightHandlers = () => {
        if (!isPortfolioView) return;
        getWeightFields().forEach(({field, number, slider, shares, tickerInput, index}) => {
            if (number.dataset.bound === "1") return;
            number.dataset.bound = "1";
            if (shares) shares.dataset.bound = "1";
            if (tickerInput) tickerInput.dataset.lastTicker = sanitizeTicker(tickerInput.value.trim());
            const syncAndRefresh = (source) => {
                const value = Math.min(100, Math.max(0, Number.parseInt(String(source.value || 0), 10) || 0));
                number.value = String(value);
                slider.value = String(value);
                rebalancePortfolioWeights(index);
                dispatchPortfolioPreviewUpdate();
                validatePortfolioWeightInputs();
                requestWorkspaceChartTransition("portfolio-weight");
                scheduleAutoSubmit(180);
            };
            const syncSharesAndRefresh = (source) => {
                const value = Math.max(0, Number.parseInt(String(source.value || 0), 10) || 0);
                if (shares) shares.value = String(value);
                dispatchPortfolioPreviewUpdate();
                validatePortfolioWeightInputs();
                requestWorkspaceChartTransition("portfolio-shares");
                if (isPortfolioShareMode()) scheduleAutoSubmit(180);
            };
            const openSlider = () => {
                if (isPortfolioShareMode()) return;
                field.querySelector(".portfolio-weight-field")?.classList.add("is-open");
            };
            const closeSlider = () => window.setTimeout(() => {
                if (field.matches(":focus-within")) return;
                field.querySelector(".portfolio-weight-field")?.classList.remove("is-open");
            }, 80);
            number.addEventListener("focus", openSlider);
            number.addEventListener("click", openSlider);
            slider.addEventListener("focus", openSlider);
            field.addEventListener("focusout", closeSlider);
            number.addEventListener("input", () => syncAndRefresh(number));
            slider.addEventListener("input", () => syncAndRefresh(slider));
            shares?.addEventListener("input", () => syncSharesAndRefresh(shares));
            field.querySelectorAll(".portfolio-share-stepper-button").forEach((button) => {
                if (button.dataset.bound === "1") return;
                button.dataset.bound = "1";
                button.addEventListener("click", () => {
                    if (!shares || shares.disabled) return;
                    const step = Number.parseInt(button.dataset.shareStep || "0", 10) || 0;
                    syncPortfolioShareInput({shares}, (Number.parseInt(shares.value || "0", 10) || 0) + step);
                    syncSharesAndRefresh(shares);
                });
            });
            tickerInput?.addEventListener("input", () => {
                handlePortfolioTickerValueChange(tickerInput);
            });
        });
    };

    const validateTickerInput = (input) => {
        const rawValue = input.value.trim();
        const value = syncTickerIdentityState(input, sanitizeTicker(rawValue));
        input.value = value;
        const duplicateTooltip = input.parentElement.querySelector(".field-tooltip-duplicate");
        const unknownTooltip = input.parentElement.querySelector(".field-tooltip-invalid");
        const counts = new Map();
        getFilledTickers().forEach((ticker) => counts.set(ticker, (counts.get(ticker) || 0) + 1));
        const isDuplicate = value && (counts.get(value) || 0) > 1;
        const isMalformed = Boolean(value) && !tickerPattern.test(value);
        const isUnknown = input.dataset.unknown === "1";

        const shouldFlag = isDuplicate || isMalformed || isUnknown;
        input.classList.toggle("is-invalid", shouldFlag);
        syncTickerClearButton(input);
        syncTickerInputDecoration(input);
        if (duplicateTooltip) duplicateTooltip.hidden = !isDuplicate;
        if (unknownTooltip) unknownTooltip.hidden = !isUnknown;
        if (isMalformed) {
            input.setCustomValidity("Enter a valid ticker symbol.");
        } else if (isDuplicate) {
            input.setCustomValidity("Ticker symbol must be unique.");
        } else if (isUnknown) {
            input.setCustomValidity(UNKNOWN_MESSAGE);
        } else if (input.required && !value) {
            input.setCustomValidity("Enter a ticker symbol.");
        } else {
            input.setCustomValidity("");
        }
        if (!input.validationMessage) hideTickerValidationTooltip(input);
        return value;
    };

    const validateAllTickerInputs = () => {
        getTickerInputs().forEach((input) => validateTickerInput(input));
    };

    const readTickerControlWidthRatio = (element) => {
        if (!(element instanceof HTMLElement)) return 1;
        const rawValue = getComputedStyle(element).getPropertyValue("--ticker-control-width").trim();
        if (rawValue.endsWith("%")) {
            const ratio = Number.parseFloat(rawValue);
            return Number.isFinite(ratio) ? ratio / 100 : 1;
        }
        const ratio = Number.parseFloat(rawValue);
        return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    };

    const readTickerValidationArrowRise = (element) => {
        if (!(element instanceof HTMLElement)) return 0;
        const rawValue = getComputedStyle(element).getPropertyValue("--ticker-validation-arrow-rise").trim();
        const rise = Number.parseFloat(rawValue);
        return Number.isFinite(rise) ? rise : 0;
    };

    const positionTickerValidationTooltip = (input) => {
        if (!(input instanceof HTMLElement)) return;
        const tooltipId = input.dataset.validationTooltipId;
        if (!tooltipId) return;
        const tooltip = document.getElementById(tooltipId);
        if (!(tooltip instanceof HTMLElement) || tooltip.hidden) return;
        const host = input.closest(".ticker-input-main");
        if (!(host instanceof HTMLElement)) return;
        const hostRect = host.getBoundingClientRect();
        const controls = input.closest(".compare-controls, .portfolio-controls, .trade-controls, .ticker-form-controls, .ticker-controls");
        const widthRatio = readTickerControlWidthRatio(controls || host);
        const arrowRise = readTickerValidationArrowRise(controls || host);
        tooltip.style.left = `${hostRect.left + (hostRect.width * widthRatio / 2)}px`;
        tooltip.style.top = `${hostRect.top + (hostRect.height / 2) + (arrowRise / 2)}px`;
    };

    const syncVisibleTickerValidationTooltips = () => {
        getTickerInputs().forEach((input) => positionTickerValidationTooltip(input));
    };

    const ensureTickerValidationTooltip = (input) => {
        if (!(input instanceof HTMLElement)) return null;
        if (!input.id) input.id = `ticker_validation_${Math.random().toString(36).slice(2, 10)}`;
        let tooltipId = input.dataset.validationTooltipId;
        if (!tooltipId) {
            tooltipId = `${input.id}_validation_tooltip`;
            input.dataset.validationTooltipId = tooltipId;
        }
        let tooltip = document.getElementById(tooltipId);
        if (tooltip instanceof HTMLElement) return tooltip;
        tooltip = document.createElement("div");
        tooltip.id = tooltipId;
        tooltip.dataset.validationFor = input.id;
        tooltip.className = "field-tooltip field-tooltip-validation liquid-glass-surface";
        const icon = document.createElement("span");
        icon.className = "field-tooltip-validation-icon";
        icon.setAttribute("aria-hidden", "true");
        const copy = document.createElement("span");
        copy.className = "field-tooltip-validation-copy";
        tooltip.append(icon, copy);
        tooltip.hidden = true;
        document.body.appendChild(tooltip);
        return tooltip;
    };

    const hideTickerValidationTooltip = (input) => {
        const tooltip = ensureTickerValidationTooltip(input);
        if (!(tooltip instanceof HTMLElement)) return;
        tooltip.hidden = true;
        const copy = tooltip.querySelector(".field-tooltip-validation-copy");
        if (copy instanceof HTMLElement) copy.textContent = "";
    };

    const showTickerValidationTooltip = (input, message = input.validationMessage) => {
        if (!message) return;
        getTickerInputs().forEach((tickerInput) => {
            if (tickerInput !== input) hideTickerValidationTooltip(tickerInput);
        });
        if (document.activeElement !== input) {
            input.focus({preventScroll: true});
        }
        const tooltip = ensureTickerValidationTooltip(input);
        if (!(tooltip instanceof HTMLElement)) return;
        const copy = tooltip.querySelector(".field-tooltip-validation-copy");
        if (copy instanceof HTMLElement) {
            copy.textContent = message;
        } else {
            tooltip.textContent = message;
        }
        tooltip.hidden = false;
        positionTickerValidationTooltip(input);
        input.scrollIntoView({block: "nearest", inline: "nearest"});
    };

    window.addEventListener("resize", syncVisibleTickerValidationTooltips);
    document.addEventListener("scroll", syncVisibleTickerValidationTooltips, true);

    const closeTickerSuggestionPanels = ({exceptInput = null} = {}) => {
        document.querySelectorAll(".suggestions.is-open").forEach((panel) => {
            const ownerInputId = String(panel.id || "").replace(/_suggestions$/, "");
            const ownerInput = ownerInputId ? document.getElementById(ownerInputId) : null;
            if (exceptInput && ownerInput === exceptInput) return;
            panel.innerHTML = "";
            panel.classList.remove("is-open");
        });
    };

    const resolveTickerSuggestionInputForTarget = (target) => {
        if (!(target instanceof Element)) return null;
        const input = target.closest("[data-ticker-input]");
        if (input instanceof HTMLInputElement) return input;
        const panel = target.closest(".suggestions");
        if (!(panel instanceof HTMLElement)) return null;
        const ownerInputId = String(panel.id || "").replace(/_suggestions$/, "");
        const ownerInput = ownerInputId ? document.getElementById(ownerInputId) : null;
        return ownerInput instanceof HTMLInputElement ? ownerInput : null;
    };

    const bindTickerSuggestionDismissal = () => {
        if (document.body.dataset.tickerSuggestionDismissalBound === "1") return;
        document.body.dataset.tickerSuggestionDismissalBound = "1";
        document.addEventListener("pointerdown", (event) => {
            closeTickerSuggestionPanels({
                exceptInput: resolveTickerSuggestionInputForTarget(event.target),
            });
        }, true);
        document.addEventListener("focusin", (event) => {
            closeTickerSuggestionPanels({
                exceptInput: resolveTickerSuggestionInputForTarget(event.target),
            });
        }, true);
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeTickerSuggestionPanels();
        }, true);
    };

    const setupAutocomplete = (input) => {
        if (!input || input.dataset.autocompleteReady === "1") return;
        bindTickerSuggestionDismissal();
        input.dataset.autocompleteReady = "1";
        let autocompleteRequestSequence = 0;
        let autocompleteTimer = 0;
        let activeIndex = -1;

        const getPanel = () => document.getElementById(`${input.id}_suggestions`);
        const getButtons = () => Array.from(getPanel()?.querySelectorAll(".suggestion-item") || []);
        const showLoadingPanel = (ticker) => {
            const panel = getPanel();
            const symbol = sanitizeTicker(ticker || "");
            if (!panel || !symbol) return;
            const status = document.createElement("div");
            status.className = "suggestion-loading";
            status.setAttribute("role", "status");
            status.setAttribute("aria-live", "polite");
            const spinner = document.createElement("span");
            spinner.className = "suggestion-loading-spinner";
            spinner.setAttribute("aria-hidden", "true");
            const copy = document.createElement("span");
            copy.textContent = `Fetching ${symbol}\u2026`;
            status.append(spinner, copy);
            panel.replaceChildren(status);
            panel.classList.add("is-open");
            activeIndex = -1;
        };
        const querySuggestions = async (rawValue, {limit = 5, preserveUnknown = false} = {}) => {
            const queryValue = sanitizeTicker(String(rawValue || "").trim());
            if (!queryValue) {
                if (!preserveUnknown) setUnknown(false);
                await showRecentItems();
                return;
            }
            const requestId = ++autocompleteRequestSequence;
            showLoadingPanel(queryValue);
            try {
                const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(queryValue)}&limit=${limit}`);
                if (!response.ok) return closePanel();
                const payload = await response.json();
                if (
                    requestId !== autocompleteRequestSequence
                    || input.dataset.composing === "1"
                    || sanitizeTicker(input.value.trim()) !== queryValue
                ) return;
                if (!Array.isArray(payload) || !payload.length) {
                    if (!preserveUnknown) setUnknown(true);
                    closePanel();
                    return;
                }
                if (!preserveUnknown) {
                    const exactMatch = Boolean(applyExactTickerMatch(input, payload, queryValue));
                    tickerValidationCache.set(queryValue, exactMatch);
                    input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                    validateTickerInput(input);
                }
                renderItems(payload);
            } catch (_error) {
                closePanel();
            }
        };
        const setUnknown = (flag) => {
            input.dataset.unknown = flag ? "1" : "";
            if (flag && input.value.trim()) tickerValidationCache.set(sanitizeTicker(input.value.trim()), false);
            validateTickerInput(input);
        };
        const syncActiveSuggestion = () => {
            getButtons().forEach((button, index) => {
                button.classList.toggle("is-active", index === activeIndex);
                if (index === activeIndex) button.scrollIntoView({block: "nearest"});
            });
        };
        const closePanel = () => {
            const panel = getPanel();
            if (!panel) return;
            panel.innerHTML = "";
            panel.classList.remove("is-open");
            activeIndex = -1;
        };
        const requestTickerCalculation = (reason = "ticker-change") => {
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition(reason);
        };
        const syncCommittedTickerSelection = (reason = "ticker-change") => {
            validateAllTickerInputs();
            handlePortfolioTickerValueChange(input);
            closePanel();
            syncOneDayExtendedHoursSwitch();
            syncDateConstraints();
            if (isBacktestView) syncBacktestIntervals();
            requestTickerCalculation(reason);
        };
        const finalizeTickerLoad = (reason = "ticker-change", delay = 120) => {
            syncCommittedTickerSelection(reason);
            scheduleAutoSubmit(delay);
        };
        const showRecentItems = async () => {
            try {
                const response = await fetch(`${endpoints.symbolSearch}?limit=5`);
                if (!response.ok) return closePanel();
                const payload = await response.json();
                if (!payload.length) return closePanel();
                renderItems(payload);
            } catch (_error) {
                closePanel();
            }
        };
        const applySuggestion = (item, {autoLoad = false} = {}) => {
            const selectedSymbol = sanitizeTicker(item.symbol || "");
            input.value = selectedSymbol;
            input.dataset.unknown = "";
            input.dataset.validationTicker = selectedSymbol;
            tickerValidationCache.set(selectedSymbol, true);
            setTickerValidationPending(input, false);
            input.setCustomValidity("");
            syncTickerInputDecoration(input, item);
            input.focus();
            if (autoLoad) {
                finalizeTickerLoad("ticker-change", 72);
                return;
            }
            syncCommittedTickerSelection("ticker-change");
        };

        const renderItems = (items) => {
            const panel = getPanel();
            if (!panel) return;
            if (!items.length) {
                closePanel();
                return;
            }
            setUnknown(false);
            const groups = [
                {key: "recent", title: "Recent"},
                {key: "local", title: "Local"},
                {key: "remote", title: "Matches"},
            ].filter((group) => items.some((item) => item.source === group.key));
            panel.innerHTML = groups.map((group) => {
                const entries = items.filter((item) => item.source === group.key);
                return `
					<div class="suggestion-group">
						<div class="suggestion-group-label">${group.title}</div>
						${entries.map((item) => `
							<button type="button" class="suggestion-item" data-symbol="${item.symbol}" data-logo-url="${item.logo_url || ""}" data-name="${item.name}">
								<span class="suggestion-row">
									<span class="suggestion-logo-slot">
										<span class="suggestion-logo-placeholder"></span>
										${item.logo_url ? `<img class="suggestion-logo" src="${item.logo_url}" alt="${item.symbol} logo">` : ""}
									</span>
									<span class="suggestion-copy">
										<span class="suggestion-symbol">${item.symbol}</span>
										<span class="suggestion-name">${item.name}</span>
									</span>
								</span>
							</button>
						`).join("")}
					</div>
				`;
            }).join("");
            panel.classList.add("is-open");
            activeIndex = -1;
            panel.querySelectorAll(".suggestion-item").forEach((button) => {
                button.addEventListener("mouseenter", () => {
                    activeIndex = getButtons().indexOf(button);
                    syncActiveSuggestion();
                });
                button.addEventListener("pointerdown", (event) => {
                    event.preventDefault();
                });
                button.addEventListener("click", () => {
                    applySuggestion({
                        symbol: button.dataset.symbol || "",
                        logo_url: button.dataset.logoUrl || "",
                        name: button.dataset.name || button.dataset.symbol || "",
                    }, {autoLoad: true});
                });
            });
        };

        const handleTickerInput = async () => {
            if (isPortfolioView) requestWorkspaceChartTransition("ticker-edit");
            else if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
            hideTickerValidationTooltip(input);
            syncTickerIdentityState(input, sanitizeTicker(input.value.trim()));
            syncTickerInputDecoration(input);
            syncOneDayExtendedHoursSwitch();
            const rawQuery = input.value.trim();
            const query = validateTickerInput(input);
            if (!rawQuery) {
                autocompleteRequestSequence += 1;
                if (autocompleteTimer) {
                    window.clearTimeout(autocompleteTimer);
                    autocompleteTimer = 0;
                }
                setUnknown(false);
                await showRecentItems();
                return;
            }
            if (autocompleteTimer) {
                window.clearTimeout(autocompleteTimer);
                autocompleteTimer = 0;
            }
            const requestId = ++autocompleteRequestSequence;
            if (query && tickerPattern.test(query)) showLoadingPanel(query);
            autocompleteTimer = window.setTimeout(async () => {
                autocompleteTimer = 0;
                try {
                    reportFetchAbortDebug("A", "app.js:setupAutocomplete", "starting symbol search request", {
                        rawQuery,
                        query,
                        inputId: input.id || "",
                        requestId,
                    });
                    const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(rawQuery)}`);
                    reportFetchAbortDebug("A", "app.js:setupAutocomplete", "symbol search response received", {
                        rawQuery,
                        query,
                        inputId: input.id || "",
                        status: response.status,
                        requestId,
                    });
                    if (requestId !== autocompleteRequestSequence || sanitizeTicker(input.value.trim()) !== query) return;
                    if (!response.ok) return closePanel();
                    const payload = await response.json();
                    if (requestId !== autocompleteRequestSequence || sanitizeTicker(input.value.trim()) !== query) return;
                    if (!payload.length) {
                        setUnknown(true);
                        closePanel();
                        return;
                    }
                    const exactMatch = Boolean(applyExactTickerMatch(input, payload, query));
                    if (query) tickerValidationCache.set(query, exactMatch);
                    input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                    validateTickerInput(input);
                    renderItems(payload);
                } catch (error) {
                    reportFetchAbortDebug("A", "app.js:setupAutocomplete", "symbol search request failed", {
                        rawQuery,
                        query,
                        inputId: input.id || "",
                        requestId,
                        errorName: error?.name || "",
                        errorMessage: error?.message || "",
                    });
                    if (requestId === autocompleteRequestSequence) closePanel();
                }
            }, 50);
        };
        input.addEventListener("compositionstart", () => {
            input.dataset.composing = "1";
            autocompleteRequestSequence += 1;
            closePanel();
            if (autocompleteTimer) {
                window.clearTimeout(autocompleteTimer);
                autocompleteTimer = 0;
            }
        });
        input.addEventListener("compositionend", () => {
            delete input.dataset.composing;
            input.dataset.skipComposedInput = "1";
            void handleTickerInput();
            window.queueMicrotask(() => {
                delete input.dataset.skipComposedInput;
            });
        });
        input.addEventListener("input", (event) => {
            if (event.isComposing || input.dataset.composing === "1") return;
            if (input.dataset.skipComposedInput === "1") {
                delete input.dataset.skipComposedInput;
                return;
            }
            void handleTickerInput();
        });
        input.addEventListener("focus", async () => {
            hideTickerValidationTooltip(input);
            if (input.value.trim()) {
                input.select();
                await querySuggestions(input.value.trim(), {preserveUnknown: true});
                return;
            }
            setUnknown(false);
            await showRecentItems();
        });
        input.addEventListener("click", async () => {
            hideTickerValidationTooltip(input);
            if (getPanel()?.classList.contains("is-open")) return;
            if (input.value.trim()) {
                input.select();
                await querySuggestions(input.value.trim(), {preserveUnknown: true});
                return;
            }
            setUnknown(false);
            await showRecentItems();
        });
        input.addEventListener("blur", () => {
            window.setTimeout(closePanel, 120);
            if (input.dataset.composing === "1") return;
            void validateTickerExistence(input, {preferFresh: true}).then((isKnown) => {
                if (isKnown) finalizeTickerLoad("ticker-change");
            });
        });
        input.addEventListener("keydown", (event) => {
            if (event.isComposing || input.dataset.composing === "1" || event.keyCode === 229) return;
            const buttons = getButtons();
            if (event.key === "ArrowDown") {
                if (!buttons.length) return;
                event.preventDefault();
                activeIndex = Math.min(activeIndex + 1, buttons.length - 1);
                syncActiveSuggestion();
                return;
            }
            if (event.key === "ArrowUp") {
                if (!buttons.length) return;
                event.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                syncActiveSuggestion();
                return;
            }
            if (event.key === "Enter" && activeIndex >= 0) {
                event.preventDefault();
                const activeButton = buttons[activeIndex];
                applySuggestion({
                    symbol: activeButton?.dataset.symbol || "",
                    logo_url: activeButton?.dataset.logoUrl || "",
                    name: activeButton?.dataset.name || activeButton?.dataset.symbol || "",
                }, {autoLoad: true});
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                finalizeTickerLoad("ticker-change", 72);
                input.blur();
                return;
            }
            if (event.key === "Escape") {
                closePanel();
            }
        });
        input.addEventListener("change", () => {
            closePanel();
            void validateTickerExistence(input, {preferFresh: true});
            finalizeTickerLoad("ticker-change");
        });
    };

    const attachTickerClearHandlers = () => {
        $$(".ticker-clear").forEach((button) => {
            if (button.dataset.bound === "1") return;
            button.dataset.bound = "1";
            button.addEventListener("mousedown", (event) => {
                event.preventDefault();
            });
            button.addEventListener("click", () => {
                const input = button.parentElement?.querySelector("[data-ticker-input]");
                if (!input) return;
                input.value = "";
                input.dataset.unknown = "";
                syncTickerIdentityState(input, "");
                syncTickerInputDecoration(input);
                validateAllTickerInputs();
                handlePortfolioTickerValueChange(input);
                syncDateConstraints();
                if (isPortfolioView) requestWorkspaceChartTransition("ticker-clear");
                scheduleAutoSubmit(120);
                input.focus();
            });
        });
    };

    const readSidebarDockPosition = () => {
        const sidebar = $(".sidebar");
        const dock = $(".sidebar-dock");
        if (!sidebar || !dock || mobileSidebarMedia.matches) return {dock, left: ""};
        const rect = sidebar.getBoundingClientRect();
        return {dock, left: `${Math.round(rect.left + rect.width / 2)}px`};
    };

    const positionSidebarDock = ({dock, left} = {}) => {
        if (!(dock instanceof HTMLElement)) return;
        dock.style.left = left || "";
    };

    const scheduleDockPosition = () => {
        dockFrame?.();
        if (window.WorthwardMotion?.scheduler?.readWrite) {
            dockFrame = window.WorthwardMotion.scheduler.readWrite(
                "sidebar-dock-position",
                readSidebarDockPosition,
                positionSidebarDock,
            );
            return;
        }
        let frameId = 0;
        frameId = window.requestAnimationFrame(() => {
            dockFrame = null;
            positionSidebarDock(readSidebarDockPosition());
        });
        dockFrame = () => window.cancelAnimationFrame(frameId);
    };

    const readElementCssPx = (element, propertyName, fallback = 0) => {
        if (!(element instanceof HTMLElement)) return fallback;
        const rawValue = getComputedStyle(element).getPropertyValue(propertyName).trim();
        const px = Number.parseFloat(rawValue);
        return Number.isFinite(px) ? px : fallback;
    };

    const isVerticallyScrollable = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hidden || element.getClientRects().length === 0) return false;
        const styles = getComputedStyle(element);
        if (!["auto", "scroll", "overlay"].includes(styles.overflowY)) return false;
        return element.clientHeight > 0 && element.scrollHeight > (element.clientHeight + 1);
    };

    const isMobilePageScrollHostCandidate = (candidate, page) => {
        if (!(candidate instanceof HTMLElement) || candidate === page) return false;
        if (!page.contains(candidate) || !isVerticallyScrollable(candidate)) return false;
        return candidate.clientHeight >= (page.clientHeight * 0.45) && candidate.clientWidth >= (page.clientWidth * 0.6);
    };

    const getMobilePageBottomPaddingScrollHost = (page) => {
        if (!(page instanceof HTMLElement)) return null;
        if (isMobilePageScrollHostCandidate(mobilePagePaddingScrollTarget, page)) return mobilePagePaddingScrollTarget;
        const workspacePanel = $("#workspace_panel");
        if (!(workspacePanel instanceof HTMLElement)) return page;
        const candidates = Array.from(workspacePanel.querySelectorAll(".workspace-header > .chart-surface, .settings-surface, .settings-workspace-header, .timing-surface"));
        let bestCandidate = null;
        let bestHeight = 0;
        for (const candidate of candidates) {
            if (!isMobilePageScrollHostCandidate(candidate, page)) continue;
            if (candidate.clientHeight <= bestHeight) continue;
            bestCandidate = candidate;
            bestHeight = candidate.clientHeight;
        }
        mobilePagePaddingScrollTarget = bestCandidate;
        return bestCandidate || page;
    };

    const syncMobilePageBottomPadMetrics = (page) => {
        if (!(page instanceof HTMLElement)) return {scrollBottomPad: 0, endBottomPad: 0};
        const scrollBottomPad = readElementCssPx(page, "--page-mobile-scroll-bottom-pad-base", readElementCssPx(page, "--page-edge-pad", 10));
        const endBottomPad = scrollBottomPad;
        page.style.setProperty("--page-mobile-scroll-bottom-pad", `${scrollBottomPad}px`);
        page.style.setProperty("--page-mobile-end-bottom-pad", `${endBottomPad}px`);
        return {scrollBottomPad, endBottomPad};
    };

    const syncMobilePageBottomPadding = ({preserveBottom = false} = {}) => {
        const page = $(".page");
        if (!(page instanceof HTMLElement)) return;
        if (!mobileSidebarMedia.matches) {
            delete page.dataset.mobileScrollEdge;
            page.style.removeProperty("--page-mobile-scroll-bottom-pad");
            page.style.removeProperty("--page-mobile-end-bottom-pad");
            mobilePagePaddingScrollTarget = null;
            return;
        }

        const {scrollBottomPad, endBottomPad} = syncMobilePageBottomPadMetrics(page);
        const scrollHost = getMobilePageBottomPaddingScrollHost(page) || page;
        const isBottomState = page.dataset.mobileScrollEdge === "bottom";
        const activeBottomPad = scrollHost === page && isBottomState ? endBottomPad : scrollBottomPad;
        const contentHeight = scrollHost === page
            ? Math.max(0, scrollHost.scrollHeight - activeBottomPad)
            : scrollHost.scrollHeight;
        const baseBottomScrollTop = scrollHost === page
            ? Math.max(0, contentHeight + scrollBottomPad - scrollHost.clientHeight)
            : Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
        const bottomThreshold = Math.max(2, Math.round(scrollBottomPad));
        const shouldUseEndBottomPad = scrollHost === page
            ? contentHeight <= scrollHost.clientHeight || scrollHost.scrollTop >= (baseBottomScrollTop - bottomThreshold)
            : scrollHost.scrollTop >= (baseBottomScrollTop - bottomThreshold);

        if (scrollHost === page && shouldUseEndBottomPad) page.dataset.mobileScrollEdge = "bottom";
        else delete page.dataset.mobileScrollEdge;

        if (preserveBottom && scrollHost === page && shouldUseEndBottomPad && !isBottomState) {
            window.requestAnimationFrame(() => {
                const targetScrollTop = Math.max(0, contentHeight + endBottomPad - scrollHost.clientHeight);
                if (page.scrollTop < targetScrollTop) page.scrollTop = targetScrollTop;
            });
        }
    };

    const scheduleMobilePageBottomPaddingSync = ({preserveBottom = false} = {}) => {
        if (preserveBottom) mobilePagePaddingShouldPreserveBottom = true;
        if (mobilePagePaddingFrame) return;
        mobilePagePaddingFrame = window.requestAnimationFrame(() => {
            mobilePagePaddingFrame = 0;
            const shouldPreserveBottom = mobilePagePaddingShouldPreserveBottom;
            mobilePagePaddingShouldPreserveBottom = false;
            syncMobilePageBottomPadding({preserveBottom: shouldPreserveBottom});
        });
    };

    const initMobilePageBottomPadding = () => {
        const page = $(".page");
        if (!(page instanceof HTMLElement)) return;
        if (page.dataset.mobileBottomPaddingBound !== "1") {
            page.dataset.mobileBottomPaddingBound = "1";
            page.addEventListener("scroll", () => scheduleMobilePageBottomPaddingSync({preserveBottom: true}), {passive: true});
        }
        if (!mobilePagePaddingScrollBound) {
            mobilePagePaddingScrollBound = true;
            document.addEventListener("scroll", (event) => {
                const pageElement = $(".page");
                if (!(pageElement instanceof HTMLElement)) return;
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                if (target !== pageElement && !pageElement.contains(target)) return;
                if (target === pageElement) mobilePagePaddingScrollTarget = null;
                else if (isMobilePageScrollHostCandidate(target, pageElement)) mobilePagePaddingScrollTarget = target;
                scheduleMobilePageBottomPaddingSync({preserveBottom: target === pageElement});
            }, {capture: true, passive: true});
        }
        if (mobilePagePaddingObserver) mobilePagePaddingObserver.disconnect();
        mobilePagePaddingObserver = null;
        if (typeof ResizeObserver === "function") {
            mobilePagePaddingObserver = new ResizeObserver(() => scheduleMobilePageBottomPaddingSync());
            mobilePagePaddingObserver.observe(page);
            const workspacePanel = $("#workspace_panel");
            if (workspacePanel instanceof HTMLElement) mobilePagePaddingObserver.observe(workspacePanel);
        }
        scheduleMobilePageBottomPaddingSync();
    };

    const readThemeModePreference = () => {
        try {
            const stored = preferenceStorage.local.getItem(THEME_MODE_STORAGE_KEY);
            return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
        } catch (_error) {
            return "system";
        }
    };

    const writeThemeModePreference = (mode) => {
        try {
            preferenceStorage.local.setItem(THEME_MODE_STORAGE_KEY, mode);
        } catch (_error) {
        }
    };

    const applyThemeModePreference = (mode) => {
        const normalizedMode = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
        const previousMode = document.documentElement.dataset.themeMode;

        if (previousMode && previousMode !== normalizedMode) {
            document.documentElement.classList.add("is-theme-transitioning");
            window.setTimeout(() => document.documentElement.classList.remove("is-theme-transitioning"), 400);
        }

        document.documentElement.dataset.themeMode = normalizedMode;
        if (normalizedMode === "system") {
            document.documentElement.removeAttribute("data-theme-override");
        } else {
            document.documentElement.setAttribute("data-theme-override", normalizedMode);
        }
        window.dispatchEvent(new CustomEvent("worthward:theme-mode-change", {
            detail: {mode: normalizedMode},
        }));
    };

    const getEffectiveThemeMode = (mode = document.documentElement.dataset.themeMode) => {
        if (mode === "light" || mode === "dark") return mode;
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };

    const syncThemeModeForm = (mode) => {
        const formElement = document.querySelector("[data-theme-mode-form]");
        if (!(formElement instanceof HTMLFormElement)) return;
        const normalizedMode = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
        Array.from(formElement.querySelectorAll("[data-theme-mode-option]")).forEach((option) => {
            if (option instanceof HTMLInputElement) option.checked = option.value === normalizedMode;
        });
    };

    const syncGlobalThemeToggle = () => {
        const toggle = document.getElementById("global_theme_toggle");
        if (!(toggle instanceof HTMLButtonElement)) return;
        const effectiveMode = getEffectiveThemeMode();
        const nextMode = effectiveMode === "dark" ? "light" : "dark";
        const label = nextMode === "dark" ? translateUi("Switch to Dark mode") : translateUi("Switch to Light mode");
        toggle.dataset.effectiveTheme = effectiveMode;
        toggle.setAttribute("aria-label", label);
        toggle.setAttribute("title", label);
        toggle.setAttribute("aria-pressed", String(effectiveMode === "dark"));
    };

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (document.documentElement.dataset.themeMode === "system") {
            window.dispatchEvent(new CustomEvent("worthward:theme-mode-change", {
                detail: {mode: "system"},
            }));
        }
    });

    const initThemeModeControls = () => {
        const currentMode = readThemeModePreference();
        applyThemeModePreference(currentMode);
        syncGlobalThemeToggle();
        const formElement = document.querySelector("[data-theme-mode-form]");
        if (!(formElement instanceof HTMLFormElement)) return;
        const options = Array.from(formElement.querySelectorAll("[data-theme-mode-option]"));
        options.forEach((option) => {
            if (!(option instanceof HTMLInputElement)) return;
            option.checked = option.value === currentMode;
            if (option.dataset.boundThemeMode === "1") return;
            option.dataset.boundThemeMode = "1";
            option.addEventListener("change", () => {
                if (!option.checked) return;
                writeThemeModePreference(option.value);
                applyThemeModePreference(option.value);
                syncGlobalThemeToggle();
            });
        });
    };

    bootstrap.initThemeModeControls = initThemeModeControls;

    const initGlobalAppearanceControls = () => {
        const themeToggle = document.getElementById("global_theme_toggle");
        if (themeToggle instanceof HTMLButtonElement && themeToggle.dataset.boundThemeToggle !== "1") {
            themeToggle.dataset.boundThemeToggle = "1";
            themeToggle.addEventListener("click", () => {
                const nextMode = getEffectiveThemeMode() === "dark" ? "light" : "dark";
                writeThemeModePreference(nextMode);
                applyThemeModePreference(nextMode);
                syncThemeModeForm(nextMode);
                syncGlobalThemeToggle();
            });
        }
        syncGlobalThemeToggle();
        window.addEventListener("worthward:theme-mode-change", () => {
            syncThemeModeForm(document.documentElement.dataset.themeMode);
            syncGlobalThemeToggle();
        });
    };

    const initGlobalLanguageControls = () => {
        const toggle = document.getElementById("global_language_toggle");
        if (!(toggle instanceof HTMLButtonElement)) return;
        const languageState = getLanguageState();
        const languageLabel = languageState.labels?.[languageState.code] || translateUi("Language");
        toggle.setAttribute("aria-label", `${translateUi("Language")}: ${languageLabel}`);
        toggle.setAttribute("title", `${translateUi("Language")}: ${languageLabel}`);
        if (toggle.dataset.boundLanguageToggle === "1") return;
        toggle.dataset.boundLanguageToggle = "1";
        toggle.addEventListener("click", async () => {
            toggle.disabled = true;
            try {
                const response = await fetch("/api/settings/language/cycle", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({current: getLanguageState().code || "en"}),
                });
                const payload = await response.json().catch(() => null);
                if (payload?.success) {
                    if (window.WORTHWARD_APP?.language) {
                        window.WORTHWARD_APP.language.code = payload.language;
                        window.WORTHWARD_APP.language.htmlLang = payload.htmlLang;
                    }
                    if (payload.dateDisplay && window.WORTHWARD_APP?.dateDisplay) {
                        window.WORTHWARD_APP.dateDisplay = payload.dateDisplay;
                    }
                    window.location.reload();
                    return;
                }
            } catch (_error) {
            }
            toggle.disabled = false;
        });
    };

    const showWorkspaceModal = (options = {}) => {
        if (!workspaceModalOverlay) return;
        if (workspaceModalOverlayTitle && options.title) workspaceModalOverlayTitle.textContent = options.title;
        if (workspaceModalOverlayCopy && options.copy) workspaceModalOverlayCopy.textContent = options.copy;
        if (workspaceModalOverlayIcon) {
            workspaceModalOverlayIcon.className = "suggestion-loading-spinner workspace-modal-icon";
        }
        workspaceModalOverlay.hidden = false;
    };

    const showImmediateRangeLoadingDialog = () => {
        if (state.currentView === "prices" && isMarketCapComparison()) {
            showWorkspaceModal({
                title: translateUi("Calculating market-cap history"),
                copy: translateUi("Combining historical prices with point-in-time shares for the selected range. Longer ranges may take a moment."),
                loadingSpinner: true,
            });
            return;
        }
        if (state.currentView === "prices") {
            showWorkspaceModal({
                title: translateUi("Updating price history"),
                copy: translateUi("Loading the selected New York market-time range while keeping the current chart context visible."),
                loadingSpinner: true,
            });
            return;
        }
    };

    const showCompareOverlay = () => {
        showWorkspaceModal({
            title: isBacktestView ? "Running your backtest" : "Preparing your chart",
            copy: isBacktestView
                ? "Please wait while the app prepares the selected daily data and runs the backtest."
                : "Please wait while the app checks local data and prepares the chart. This may take a little longer for a new ticker.",
            loadingSpinner: true,
        });
    };

    const hideWorkspaceModal = () => {
        if (!workspaceModalOverlay) return;
        if (compareOverlayTimer) {
            window.clearTimeout(compareOverlayTimer);
            compareOverlayTimer = null;
        }
        workspaceModalOverlay.hidden = true;
    };

    const cancelActiveWorkspaceSubmission = () => {
        if (!isSubmittingWithOverlay) return false;
        workspaceSubmitToken += 1;
        abortActiveWorkspaceHydration();
        isSubmittingWithOverlay = false;
        setFormBusyState(false);
        hideWorkspaceModal();
        return true;
    };

    const scheduleCompareOverlay = () => {
        if (compareOverlayTimer) window.clearTimeout(compareOverlayTimer);
        compareOverlayTimer = window.setTimeout(() => {
            showCompareOverlay();
        }, 180);
    };

    const didCompareRequestChangeRange = (currentParams, nextParams) => {
        const rangeKeys = ["period", "range", "date", "trading_date", "exact_trading_date", "from", "exact_start", "to", "exact_end", "extended-hours", "extended_hours", "include_extended_hours", "overnight", "include_overnight"];
        for (const key of rangeKeys) {
            const current = (currentParams.get(key) || "").toString().trim();
            const next = (nextParams.get(key) || "").toString().trim();
            if (current !== next) return true;
        }
        return false;
    };

    const didCompareRequestChangeMetric = (currentParams, nextParams) => (
        normalizeComparisonMetric(currentParams.get("metric"))
        !== normalizeComparisonMetric(nextParams.get("metric"))
    );

    const attachRemoveHandlers = () => {
        $$(".ticker-remove").forEach((button) => {
            if (button.dataset.bound === "1") return;
            button.dataset.bound = "1";
            button.addEventListener("click", () => {
                const field = button.closest(".ticker-field");
                const removedTicker = sanitizeTicker(field?.querySelector("[data-ticker-input]")?.value || "");
                const removedIndex = Number.parseInt(field?.dataset.index || "0", 10) - 1;
                if (isPortfolioView) requestWorkspaceChartTransition("ticker-remove");
                else if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
                const removedWeight = isPortfolioView
                    ? Number.parseInt(field?.querySelector(".portfolio-weight-input")?.value || "0", 10) || 0
                    : 0;
                field?.remove();
                reindexTickerFields();
                removeTickerFromComparePreview(removedTicker);
                if (isPortfolioView) {
                    rebalancePortfolioWeightsAfterRemoval(removedWeight, removedIndex);
                    ensurePortfolioWeightTouches();
                    syncPortfolioWeightBounds();
                    syncPortfolioWeightDisabledState();
                    validatePortfolioWeightInputs();
                    dispatchPortfolioPreviewUpdate();
                }
                validateAllTickerInputs();
                syncDateConstraints();
                scheduleAutoSubmit(120);
            });
        });
    };

    const addTickerField = (value = "", {focus = true} = {}) => {
        const container = $("#ticker_fields");
        if (!container || getTickerFields().length >= MAX_TICKERS) return;
        const index = getTickerFields().length + 1;
        const field = document.createElement("div");
        field.className = "field ticker-field";
        field.dataset.index = String(index);
        field.innerHTML = `
			<div class="ticker-input-row">
				<div class="ticker-input-main">
					<label for="ticker_${index}">Ticker ${index}</label>
					<div class="ticker-input-control">
						<span class="ticker-leading-slot" aria-hidden="true">
							<span class="ticker-logo-placeholder"></span>
							<img class="ticker-input-logo" alt="" hidden>
						</span>
						<input id="ticker_${index}" name="ticker" data-ticker-input class="text-input-control" value="${value}" placeholder="e.g. NVDA" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" title="Use a valid ticker such as MSFT, GOOGL, NVDA, AMZN, MU, AMD, or META.">
						<button type="button" class="ticker-clear" aria-label="Clear ticker"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
					</div>
					<div class="field-tooltip field-tooltip-duplicate" hidden>This ticker is already used. Choose a different one.</div>
					<div class="field-tooltip field-tooltip-invalid" hidden>Unknown or unsupported ticker.</div>
					<div class="suggestions" id="ticker_${index}_suggestions"></div>
				</div>
				${isPortfolioView ? `
				<div class="portfolio-weight-field">
					<div class="portfolio-weight-row">
						<input id="weight_${index}" name="weight" class="portfolio-weight-input" type="number" inputmode="numeric" min="0" max="100" step="1" value="0" placeholder="${labels.portfolio_weight}" aria-label="${labels.portfolio_weight}">
						<span class="portfolio-weight-unit">%</span>
						<div class="portfolio-share-stepper" role="group" aria-label="Shares">
							<button type="button" class="portfolio-share-stepper-button" data-share-step="-1" aria-label="Decrease shares">-</button>
							<input id="shares_${index}" name="shares" class="portfolio-share-input" type="number" inputmode="numeric" min="0" step="1" value="0" placeholder="0" aria-label="Shares">
							<button type="button" class="portfolio-share-stepper-button" data-share-step="1" aria-label="Increase shares">+</button>
						</div>
					</div>
					<div class="portfolio-weight-slider-shell" aria-hidden="true">
						<input class="portfolio-weight-slider" type="range" min="0" max="100" step="1" value="0" aria-label="${labels.portfolio_weight}">
					</div>
					<div class="portfolio-weight-tooltip field-tooltip" hidden></div>
				</div>` : ""}
				<button type="button" class="ticker-remove" aria-label="Remove ticker"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
			</div>
		`;
        container.appendChild(field);
        reindexTickerFields();
        if (isPortfolioView) {
            markPortfolioWeightTouched(index - 1);
        }
        attachRemoveHandlers();
        attachTickerClearHandlers();
        attachPortfolioWeightHandlers();
        const input = field.querySelector("[data-ticker-input]");
        setupAutocomplete(input);
        validateAllTickerInputs();
        syncPortfolioWeightDisabledState();
        dispatchPortfolioPreviewUpdate();
        if (focus) input?.focus();
    };

    // Bind this control before the optional workspace enhancements so a
    // recoverable enhancement failure does not disable ticker entry.
    $("#add_ticker")?.addEventListener("click", () => {
        if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
        addTickerField();
    });

    const compactTickerInputs = () => {
        const values = getFilledTickers();
        const portfolioEntries = isPortfolioView
            ? getWeightFields()
                .map((item) => ({
                    ticker: sanitizeTicker(item.tickerInput.value.trim()),
                    weight: Number.parseInt(item.number.value, 10) || 0,
                    shares: Number.parseInt(item.shares?.value || "0", 10) || 0,
                }))
                .filter((item) => item.ticker)
            : [];
        const container = $("#ticker_fields");
        if (!container) return values;
        while (getTickerFields().length > Math.max(getMinimumRequiredTickers(), values.length)) {
            getTickerFields()[getTickerFields().length - 1].remove();
        }
        getTickerInputs().forEach((input, index) => {
            input.value = values[index] || "";
        });
        if (isPortfolioView) {
            getWeightFields().forEach((entry, index) => {
                syncPortfolioWeightPair(entry, portfolioEntries[index]?.weight || 0);
                syncPortfolioShareInput(entry, portfolioEntries[index]?.shares || 0);
            });
        }
        while (getTickerFields().length < Math.max(getMinimumRequiredTickers(), values.length)) {
            addTickerField(values[getTickerFields().length] || "");
        }
        reindexTickerFields();
        syncPortfolioWeightDisabledState();
        syncPortfolioWeightBounds();
        validateAllTickerInputs();
        return values;
    };

    const form = $("form.controls");
    const comparisonMetricInputs = $$("[data-comparison-metric-input]");
    const getComparisonMetric = () => {
        const selectedInput = comparisonMetricInputs.find((input) => input.checked);
        return normalizeComparisonMetric(selectedInput?.value || state.comparisonMetric);
    };
    const clearComparisonMetricValidation = () => {
        document.querySelectorAll("[data-comparison-metric-validation]").forEach((node) => {
            node.hidden = true;
            node.textContent = "";
        });
    };
    const showComparisonMetricValidation = (message) => {
        const field = document.querySelector("[data-comparison-metric-field]");
        if (!(field instanceof HTMLElement) || !message) return;
        let feedback = field.querySelector("[data-comparison-metric-validation]");
        if (!(feedback instanceof HTMLElement)) {
            feedback = document.createElement("p");
            feedback.className = "comparison-metric-validation";
            feedback.dataset.comparisonMetricValidation = "";
            feedback.setAttribute("role", "alert");
            field.appendChild(feedback);
        }
        feedback.textContent = message;
        feedback.hidden = false;
    };
    const periodPanel = $("#period_panel");
    const exactPanel = $("#exact_panel");
    const periodSelect = $("#period");
    const rangeModeInputs = $$("input[name='range']");
    const exactStartInput = $("#exact_start");
    const exactEndInput = $("#exact_end");
    const exactTradingDateInput = $("#exact_trading_date");
    const exactRangeDateGrid = $("[data-exact-range-date-grid]");
    const exactSingleDateGrid = $("[data-exact-single-date-grid]");
    const extendedHoursInput = $("#include_extended_hours");
    const extendedHoursField = $("[data-one-day-extended-hours-field]");
    const overnightInput = $("#include_overnight_hours");
    const overnightField = $("[data-one-day-overnight-field]");
    const chipsInput = $("#show_chips");
    const priceOnlyInput = $("#price_only");
    const priceOnlyField = $("[data-price-only-field]");
    const includeDividendsInput = $("#include_dividends");
    const dividendReinvestField = $("[data-dividend-reinvest-field]");
    const stopLossInput = $("#stop_loss");
    const showTradeDetailsInput = $("#show_trade_details");
    const tradeCapitalField = $(".trade-capital-field");
    const tradeCapitalInput = $("#trade_initial_capital");
    const tradeCapitalSlider = $("#trade_initial_capital_slider");
    const getSharedSelectFields = () => Array.from(document.querySelectorAll("[data-shared-select-field]"))
        .filter((field) => field instanceof HTMLElement);
    let sharedSelectOwnerSequence = 0;
    const getSharedSelectOverlayHost = () => {
        let host = document.querySelector("[data-shared-select-overlay]");
        if (host instanceof HTMLElement) return host;
        if (!(document.body instanceof HTMLElement)) return null;
        host = document.createElement("div");
        host.className = "shared-select-overlay";
        host.dataset.sharedSelectOverlay = "";
        document.body.appendChild(host);
        return host;
    };
    const shouldPortalSharedSelectDropdown = (field) => (
        field instanceof HTMLElement
        && (
            Boolean(field.closest("[data-trade-strategy-panel]"))
            || String(field.dataset.sharedSelectKind || "").trim().toLowerCase() === "strategy"
            || String(field.dataset.sharedSelectKind || "").trim().toLowerCase() === "investment-import-broker"
            || String(field.dataset.sharedSelectKind || "").trim().toLowerCase() === "investment-transfer"
            || field.classList.contains("investment-import-broker-field")
        )
    );
    const getSharedSelectDropdown = (field) => {
        if (!(field instanceof HTMLElement)) return null;
        const nestedDropdown = field.querySelector("[data-shared-select-dropdown]");
        if (nestedDropdown instanceof HTMLElement) return nestedDropdown;
        const owner = String(field.dataset.sharedSelectOwner || "").trim();
        if (!owner) return null;
        return Array.from(document.querySelectorAll("[data-shared-select-dropdown]"))
            .find((dropdown) => dropdown instanceof HTMLElement && dropdown.dataset.sharedSelectOwner === owner)
            || null;
    };
    const portalSharedSelectDropdown = (field, dropdown) => {
        if (!shouldPortalSharedSelectDropdown(field) || !(dropdown instanceof HTMLElement)) return false;
        const host = getSharedSelectOverlayHost();
        if (!(host instanceof HTMLElement)) return false;
        const owner = String(field.dataset.sharedSelectOwner || "").trim()
            || `shared-select-${++sharedSelectOwnerSequence}`;
        field.dataset.sharedSelectOwner = owner;
        dropdown.dataset.sharedSelectOwner = owner;
        if (dropdown.parentElement !== host) host.appendChild(dropdown);
        return true;
    };
    const restoreSharedSelectDropdown = (field, dropdown) => {
        if (!shouldPortalSharedSelectDropdown(field)
            || (!field.closest("[data-trade-strategy-panel]")
                && String(field.dataset.sharedSelectKind || "").trim().toLowerCase() !== "strategy"
                && String(field.dataset.sharedSelectKind || "").trim().toLowerCase() !== "investment-transfer")
            || !(dropdown instanceof HTMLElement)) return;
        const host = dropdown.parentElement;
        if (!(host instanceof HTMLElement) || !host.matches("[data-shared-select-overlay]")) return;
        const kind = String(field.dataset.sharedSelectKind || "").trim().toLowerCase();
        const restoreParent = kind === "strategy"
            ? field.querySelector(":scope > .trade-strategy-row")
            : field;
        (restoreParent instanceof HTMLElement ? restoreParent : field).appendChild(dropdown);
        delete field.dataset.sharedSelectOwner;
        delete dropdown.dataset.sharedSelectOwner;
    };

    const isOneDayExactDateMode = () => (
        ["tickers", "prices"].includes(state.currentView)
        && (periodSelect?.value || defaults.period) === "1d"
    );

    const syncExactDateModeControls = () => {
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        const useSingleDate = rangeMode === "exact" && isOneDayExactDateMode();
        if (exactRangeDateGrid instanceof HTMLElement) exactRangeDateGrid.hidden = useSingleDate;
        if (exactSingleDateGrid instanceof HTMLElement) exactSingleDateGrid.hidden = !useSingleDate;
        if (exactStartInput) exactStartInput.disabled = useSingleDate;
        if (exactEndInput) exactEndInput.disabled = useSingleDate;
        if (exactTradingDateInput) exactTradingDateInput.disabled = !useSingleDate;
    };

    const syncDividendModeSwitches = () => {
        if (!priceOnlyInput || !includeDividendsInput) return;
        const isPriceCompare = state.currentView === "prices";
        const isOneDayPeriod = ["tickers", "prices"].includes(state.currentView) && (periodSelect?.value || defaults.period) === "1d";
        if (priceOnlyField instanceof HTMLElement) {
            priceOnlyField.hidden = isOneDayPeriod || isPriceCompare;
        }
        priceOnlyInput.disabled = isOneDayPeriod || isPriceCompare;
        includeDividendsInput.disabled = isOneDayPeriod || isPriceCompare;
        if (isOneDayPeriod || isPriceCompare) {
            priceOnlyInput.checked = false;
            includeDividendsInput.checked = false;
            if (dividendReinvestField instanceof HTMLElement) {
                dividendReinvestField.hidden = true;
            }
            return;
        }
        const isPriceOnly = priceOnlyInput.checked;
        if (isPriceOnly) includeDividendsInput.checked = false;
        if (dividendReinvestField instanceof HTMLElement) {
            dividendReinvestField.hidden = isPriceOnly;
        }
    };

    const syncOneDayOvernightSwitch = () => {
        if (!(overnightField instanceof HTMLElement) || !overnightInput) return;
        const isOneDayPeriod = ["tickers", "prices"].includes(state.currentView) && (periodSelect?.value || defaults.period) === "1d";
        const hasEligibleTicker = getFilledTickers().some(isUsTicker);
        const canUseOvernight = (
            overnightField.dataset.overnightSourceReady === "1"
            && isOneDayPeriod
            && hasEligibleTicker
        );
        overnightField.hidden = !canUseOvernight;
        overnightInput.disabled = !canUseOvernight;
        if (!canUseOvernight) overnightInput.checked = false;
    };

    const syncOneDayExtendedHoursSwitch = () => {
        if (!(extendedHoursField instanceof HTMLElement) || !extendedHoursInput) {
            syncOneDayOvernightSwitch();
            return;
        }
        const isOneDayPeriod = ["tickers", "prices"].includes(state.currentView) && (periodSelect?.value || defaults.period) === "1d";
        const canUseExtendedHours = isOneDayPeriod && areAllFilledTickersUs();
        extendedHoursField.hidden = !canUseExtendedHours;
        extendedHoursInput.disabled = !canUseExtendedHours;
        if (!canUseExtendedHours) extendedHoursInput.checked = false;
        syncOneDayOvernightSwitch();
    };

    const getSharedSelectParts = (field) => {
        if (!(field instanceof HTMLElement)) return null;
        const select = field.querySelector("select");
        const trigger = field.querySelector("[data-shared-select-trigger]");
        const triggerLabel = field.querySelector("[data-shared-select-trigger-label]");
        const controlledDropdownId = trigger?.getAttribute("aria-controls")?.trim() || "";
        const controlledDropdown = controlledDropdownId
            ? document.getElementById(controlledDropdownId)
            : null;
        const dropdown = controlledDropdown instanceof HTMLElement
            && controlledDropdown.matches("[data-shared-select-dropdown]")
            ? controlledDropdown
            : getSharedSelectDropdown(field);
        if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement) || !(triggerLabel instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) {
            return null;
        }
        const triggerLogo = trigger.querySelector("[data-shared-select-trigger-logo]");
        const triggerPlaceholder = trigger.querySelector("[data-shared-select-trigger-placeholder]");
        return {
            field,
            select,
            trigger,
            triggerLabel,
            dropdown,
            triggerLogo: triggerLogo instanceof HTMLImageElement ? triggerLogo : null,
            triggerPlaceholder: triggerPlaceholder instanceof HTMLElement ? triggerPlaceholder : null,
        };
    };

    const syncNativeSelectSelection = (select, selectedValue) => {
        if (!(select instanceof HTMLSelectElement)) return;
        const normalizedValue = String(selectedValue || "");
        Array.from(select.options).forEach((option) => {
            const isSelected = Boolean(normalizedValue) && option.value === normalizedValue;
            option.defaultSelected = isSelected;
            option.selected = isSelected;
            if (isSelected) {
                option.setAttribute("selected", "selected");
            } else {
                option.removeAttribute("selected");
            }
        });
        select.value = normalizedValue;
    };

    const syncSharedSelectTriggerMedia = (parts, selectedOption) => {
        if (!parts?.triggerLogo) return;
        const iconUrl = String(selectedOption?.dataset.iconUrl || "").trim();
        const iconAlt = String(selectedOption?.dataset.iconAlt || "").trim()
            || `${selectedOption?.textContent?.trim() || selectedOption?.value || "Selected"} logo`;
        if (!iconUrl) {
            if (!parts.triggerLogo.hidden) parts.triggerLogo.hidden = true;
            if (parts.triggerLogo.alt !== "") parts.triggerLogo.alt = "";
            if (parts.triggerLogo.hasAttribute("src")) parts.triggerLogo.removeAttribute("src");
            if (parts.triggerPlaceholder) {
                if (parts.triggerPlaceholder.hidden) parts.triggerPlaceholder.hidden = false;
            }
            return;
        }
        if (parts.triggerLogo.alt !== iconAlt) parts.triggerLogo.alt = iconAlt;
        if (parts.triggerLogo.hidden) parts.triggerLogo.hidden = false;
        if (parts.triggerLogo.getAttribute("src") !== iconUrl) {
            parts.triggerLogo.src = iconUrl;
        }
        if (parts.triggerPlaceholder) {
            if (!parts.triggerPlaceholder.hidden) parts.triggerPlaceholder.hidden = true;
        }
        parts.triggerLogo.onerror = () => {
            parts.triggerLogo.hidden = true;
            parts.triggerLogo.removeAttribute("src");
            if (parts.triggerPlaceholder) {
                parts.triggerPlaceholder.hidden = false;
            }
        };
    };

    const SIDEBAR_OVERLAY_GAP_PX = 4;
    const getSidebarOverlayMetrics = (anchorRect, minimumHeight = 120) => {
        if (!(anchorRect instanceof DOMRect)) return null;
        const sidebar = document.querySelector(".sidebar");
        if (!(sidebar instanceof HTMLElement)) return null;
        const sidebarRect = sidebar.getBoundingClientRect();
        const dock = document.querySelector(".sidebar-dock");
        const rootStyles = getComputedStyle(document.documentElement);
        const pageEdgePad = Number.parseFloat(rootStyles.getPropertyValue("--page-edge-pad")) || 10;
        const lowerBoundary = dock instanceof HTMLElement
            ? Math.min(sidebarRect.bottom, dock.getBoundingClientRect().top) - pageEdgePad
            : sidebarRect.bottom - pageEdgePad;
        const availableHeight = Math.max(minimumHeight, lowerBoundary - anchorRect.bottom - SIDEBAR_OVERLAY_GAP_PX);
        return {availableHeight};
    };

    const resetSidebarDropdownPosition = (dropdown) => {
        if (!(dropdown instanceof HTMLElement)) return;
        dropdown.style.position = "";
        dropdown.style.left = "";
        dropdown.style.top = "";
        dropdown.style.bottom = "";
        dropdown.style.right = "";
        dropdown.style.width = "";
        dropdown.style.minWidth = "";
        dropdown.style.maxWidth = "";
        dropdown.style.maxHeight = "";
        dropdown.style.height = "";
        dropdown.style.zIndex = "";
        dropdown.style.overflowY = "";
        dropdown.style.maxWidth = "";
        dropdown.style.overscrollBehavior = "";
    };

    const positionSidebarDropdownFromTrigger = (trigger, dropdown, container) => {
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement) || !(container instanceof HTMLElement)) return;
        const triggerRect = trigger.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const overlayMetrics = getSidebarOverlayMetrics(triggerRect);
        const left = Math.max(0, triggerRect.left - containerRect.left);
        const top = Math.max(0, triggerRect.bottom - containerRect.top + SIDEBAR_OVERLAY_GAP_PX);
        const width = Math.max(0, triggerRect.width);
        dropdown.style.left = `${Math.round(left)}px`;
        dropdown.style.top = `${Math.round(top)}px`;
        dropdown.style.right = "auto";
        dropdown.style.width = `${width}px`;
        dropdown.style.maxHeight = overlayMetrics ? `${Math.round(overlayMetrics.availableHeight)}px` : "";
    };

    const positionSharedSelectDropdown = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts || parts.dropdown.hidden) return;
        const dropdown = parts.dropdown;
        const trigger = parts.trigger;
        const triggerRect = trigger.getBoundingClientRect();
        // Constrained menus must not inherit the form's transformed and clipped context.
        const isInsideImportForm = !!trigger.closest('#transaction_form_container')
            || parts.field.classList.contains('investment-import-broker-field')
            || parts.field.dataset.sharedSelectKind === 'investment-import-broker';
        const isInsideStrategyPanel = Boolean(trigger.closest("[data-trade-strategy-panel]"));
        const isTradeStrategyField = String(parts.field.dataset.sharedSelectKind || "").trim().toLowerCase() === "strategy";
        const isInvestmentTransfer = String(parts.field.dataset.sharedSelectKind || "").trim().toLowerCase() === "investment-transfer";
        if (isInsideImportForm || isInsideStrategyPanel || isTradeStrategyField || isInvestmentTransfer) {
            // Portal constrained menus above clipped form containers before positioning them.
            portalSharedSelectDropdown(field, dropdown);
            const dropdownGap = 4;
            const viewport = window.visualViewport;
            const viewportLeft = Number(viewport?.offsetLeft) || 0;
            const viewportTop = Number(viewport?.offsetTop) || 0;
            const viewportWidth = Number(viewport?.width) || window.innerWidth || 0;
            const viewportHeight = Number(viewport?.height) || window.innerHeight || 0;
            const viewportRight = viewportLeft + viewportWidth;
            const viewportBottom = viewportTop + viewportHeight;
            const viewportEdge = 12;
            const maxWidth = Math.max(0, Math.min(420, viewportWidth - (viewportEdge * 2)));
            const triggerWidth = Math.max(0, triggerRect.width);
            const availableWidth = Math.max(0, viewportRight - viewportEdge - Math.max(viewportLeft + viewportEdge, triggerRect.left));
            const menuWidth = Math.min(
                maxWidth,
                Math.max(triggerWidth, availableWidth),
            );

            dropdown.style.position = 'fixed';
            dropdown.style.left = `${Math.round(Math.min(
                Math.max(viewportLeft + viewportEdge, triggerRect.left),
                viewportRight - viewportEdge - menuWidth,
            ))}px`;
            dropdown.style.top = `${Math.round(triggerRect.bottom + dropdownGap)}px`;
            dropdown.style.bottom = 'auto';
            dropdown.style.right = 'auto';
            dropdown.style.width = 'max-content';
            dropdown.style.minWidth = `${Math.round(Math.min(triggerWidth, menuWidth))}px`;
            dropdown.style.maxWidth = `${Math.round(maxWidth)}px`;
            dropdown.style.maxHeight = 'none';
            dropdown.style.height = 'auto';

            const measuredWidth = isTradeStrategyField
                ? triggerWidth
                : Math.max(triggerWidth, dropdown.getBoundingClientRect().width);
            const boundedWidth = Math.min(maxWidth, measuredWidth);
            const boundedLeft = Math.min(
                Math.max(viewportLeft + viewportEdge, triggerRect.left),
                viewportRight - viewportEdge - boundedWidth,
            );
            dropdown.style.width = `${Math.round(boundedWidth)}px`;
            dropdown.style.left = `${Math.round(boundedLeft)}px`;

            const naturalHeight = Math.max(dropdown.scrollHeight, dropdown.getBoundingClientRect().height);
            const spaceBelow = Math.max(0, viewportBottom - viewportEdge - triggerRect.bottom - dropdownGap);
            const spaceAbove = Math.max(0, triggerRect.top - viewportTop - viewportEdge - dropdownGap);
            const opensAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
            const availableHeight = Math.max(0, Math.min(380, opensAbove ? spaceAbove : spaceBelow));
            const visibleHeight = Math.min(naturalHeight, availableHeight);
            const top = opensAbove
                ? Math.max(viewportTop + viewportEdge, triggerRect.top - dropdownGap - visibleHeight)
                : Math.min(viewportBottom - viewportEdge - visibleHeight, triggerRect.bottom + dropdownGap);

            dropdown.style.top = `${Math.round(top)}px`;
            dropdown.style.maxHeight = `${Math.round(availableHeight)}px`;
            dropdown.style.zIndex = '10002';

            dropdown.style.overflowY = 'auto';
            dropdown.style.overscrollBehavior = 'contain';
            return;
        }
        const container = dropdown.parentElement;
        positionSidebarDropdownFromTrigger(trigger, dropdown, container instanceof HTMLElement ? container : field);
    };

    const setSharedSelectDropdownOpen = (field, isOpen) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        parts.dropdown.hidden = !isOpen;
        parts.trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        parts.field.classList.toggle("is-open", isOpen);
        if (isOpen) {
            positionSharedSelectDropdown(field);
        } else {
            parts.trigger.removeAttribute("aria-activedescendant");
            resetSidebarDropdownPosition(parts.dropdown);
            restoreSharedSelectDropdown(field, parts.dropdown);
        }
    };

    const closeSharedSelectDropdowns = (exceptField = null) => {
        getSharedSelectFields().forEach((field) => {
            if (exceptField && field === exceptField) return;
            setSharedSelectDropdownOpen(field, false);
        });
    };

    const syncSharedSelectTriggerLabel = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        const selectedOption = Array.from(parts.select.options).find((option) => option.value === parts.select.value);
        const nextLabel = selectedOption?.textContent?.trim()
            || parts.triggerLabel.dataset.fallbackLabel
            || parts.trigger.getAttribute("title")
            || parts.trigger.textContent?.trim()
            || parts.select.options[0]?.textContent?.trim()
            || "";
        if (parts.triggerLabel.textContent !== nextLabel) parts.triggerLabel.textContent = nextLabel;
        if (parts.triggerLabel.dataset.fallbackLabel !== nextLabel) {
            parts.triggerLabel.dataset.fallbackLabel = nextLabel;
        }
        const configuredTitle = String(parts.trigger.dataset.sharedSelectTitle || "").trim();
        const nextTitle = configuredTitle || nextLabel;
        if (parts.trigger.title !== nextTitle) parts.trigger.title = nextTitle;
        const strategyParam = field.closest("[data-strategy-param-key]");
        const fieldLabel = strategyParam?.querySelector(":scope > .trade-strategy-param-label .trade-strategy-param-label-trigger > span:first-child")?.textContent?.trim()
            || field.closest(".field")?.querySelector(":scope > label")?.textContent?.trim()
            || "";
        if (fieldLabel) {
            const nextAriaLabel = `${fieldLabel}: ${nextLabel}`;
            if (parts.trigger.getAttribute("aria-label") !== nextAriaLabel) {
                parts.trigger.setAttribute("aria-label", nextAriaLabel);
            }
        }
        const nextEmptyState = nextLabel ? "0" : "1";
        if (parts.trigger.dataset.empty !== nextEmptyState) {
            parts.trigger.dataset.empty = nextEmptyState;
        }
        parts.field.classList.add("backtest-shared-select-field");
        syncSharedSelectTriggerMedia(parts, selectedOption);
    };

    const renderSharedSelectDropdown = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        const currentSelection = String(parts.select.value || "");
        parts.dropdown.innerHTML = "";
        Array.from(parts.select.options).forEach((option, optionIndex) => {
            const optionButton = document.createElement("button");
            optionButton.type = "button";
            optionButton.className = "trade-strategy-dropdown-option";
            optionButton.id = `${parts.dropdown.id || parts.select.id || "shared_select"}_option_${optionIndex}`;
            optionButton.tabIndex = -1;
            optionButton.dataset.value = option.value;
            optionButton.setAttribute("role", "option");
            optionButton.setAttribute("aria-selected", option.value === currentSelection ? "true" : "false");
            if (option.value === currentSelection) {
                optionButton.classList.add("is-selected", "is-active");
            }

            const checkElement = document.createElement("span");
            checkElement.className = "trade-strategy-dropdown-check";
            checkElement.setAttribute("aria-hidden", "true");

            const iconUrl = String(option.dataset.iconUrl || "").trim();
            if (iconUrl) {
                optionButton.classList.add("is-with-icon");
            }

            const descriptionText = option.dataset.description?.trim() || "";
            const optionLabel = option.textContent || option.value;

            optionButton.appendChild(checkElement);
            if (iconUrl) {
                const mediaSlot = document.createElement("span");
                mediaSlot.className = "trade-strategy-dropdown-media-slot";
                mediaSlot.setAttribute("aria-hidden", "true");

                const mediaPlaceholder = document.createElement("span");
                mediaPlaceholder.className = "trade-strategy-dropdown-media-placeholder";

                const mediaElement = document.createElement("img");
                mediaElement.className = "trade-strategy-dropdown-media";
                mediaElement.alt = String(option.dataset.iconAlt || "").trim()
                    || `${option.textContent?.trim() || option.value} logo`;
                mediaElement.loading = "eager";
                mediaElement.decoding = "async";
                mediaElement.hidden = true;
                mediaElement.addEventListener("load", () => {
                    mediaElement.hidden = false;
                    mediaPlaceholder.hidden = true;
                });
                mediaElement.addEventListener("error", () => {
                    mediaElement.hidden = true;
                    mediaElement.removeAttribute("src");
                    mediaPlaceholder.hidden = false;
                });
                mediaElement.src = iconUrl;
                if (mediaElement.complete && mediaElement.naturalWidth > 0 && mediaElement.naturalHeight > 0) {
                    mediaElement.hidden = false;
                    mediaPlaceholder.hidden = true;
                }

                mediaSlot.appendChild(mediaPlaceholder);
                mediaSlot.appendChild(mediaElement);
                optionButton.appendChild(mediaSlot);
            }

            if (descriptionText) {
                const copyElement = document.createElement("span");
                copyElement.className = "trade-strategy-dropdown-copy";

                const titleElement = document.createElement("span");
                titleElement.className = "trade-strategy-dropdown-title";
                titleElement.textContent = optionLabel;
                copyElement.appendChild(titleElement);

                const descriptionElement = document.createElement("span");
                descriptionElement.className = "trade-strategy-dropdown-desc";
                descriptionElement.textContent = descriptionText;
                copyElement.appendChild(descriptionElement);
                optionButton.appendChild(copyElement);
            } else {
                const textElement = document.createElement("span");
                textElement.className = "trade-strategy-dropdown-text";
                textElement.textContent = optionLabel;
                optionButton.appendChild(textElement);
            }
            optionButton.addEventListener("click", () => {
                if (parts.select.value === option.value) {
                    setSharedSelectDropdownOpen(field, false);
                    parts.trigger.focus({preventScroll: true});
                    return;
                }
                syncNativeSelectSelection(parts.select, option.value);
                syncSharedSelectTriggerLabel(field);
                renderSharedSelectDropdown(field);
                setSharedSelectDropdownOpen(field, false);
                parts.trigger.focus({preventScroll: true});
                parts.select.dispatchEvent(new Event("change", {bubbles: true}));

                // Extra safety for the investment import broker dropdown (uses fixed positioning in constrained form).
                // Ensures the field groups (e.g. Schwab CSV using the reusable div) switch immediately.
                if (field.classList.contains('investment-import-broker-field') &&
                    typeof window.__forceSyncInvestmentImportMode === 'function') {
                    window.__forceSyncInvestmentImportMode();
                }
            });
            parts.dropdown.appendChild(optionButton);
        });
    };

    const getSharedSelectOptionButtons = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return [];
        return Array.from(parts.dropdown.querySelectorAll('[role="option"]'))
            .filter((option) => option instanceof HTMLButtonElement);
    };

    const focusSharedSelectOption = (field, targetIndex = null) => {
        const parts = getSharedSelectParts(field);
        const options = getSharedSelectOptionButtons(field);
        if (!parts || !options.length) return;
        const selectedIndex = Math.max(0, options.findIndex((option) => option.getAttribute("aria-selected") === "true"));
        const resolvedIndex = targetIndex === null
            ? selectedIndex
            : Math.max(0, Math.min(options.length - 1, targetIndex));
        options.forEach((option, index) => {
            option.classList.toggle("is-active", index === resolvedIndex);
        });
        const target = options[resolvedIndex];
        parts.trigger.setAttribute("aria-activedescendant", target.id);
        target.focus({preventScroll: true});
        target.scrollIntoView({block: "nearest"});
    };

    const handleSharedSelectTriggerKeydown = (field, event) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        if (event.key === "Escape") {
            if (parts.dropdown.hidden) return;
            event.preventDefault();
            setSharedSelectDropdownOpen(field, false);
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        closeSharedSelectDropdowns(field);
        setTradeStrategyDropdownOpen(false);
        if (!field.closest("[data-trade-strategy-panel]")) {
            setTradeStrategyPanelOpen(false);
        }
        renderSharedSelectDropdown(field);
        setSharedSelectDropdownOpen(field, true);
        const options = getSharedSelectOptionButtons(field);
        const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
        focusSharedSelectOption(field, targetIndex);
    };

    const handleSharedSelectDropdownKeydown = (field, event) => {
        const parts = getSharedSelectParts(field);
        const options = getSharedSelectOptionButtons(field);
        if (!parts || !options.length) return;
        const currentIndex = Math.max(0, options.indexOf(document.activeElement));
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const targetIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                    ? options.length - 1
                    : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
            focusSharedSelectOption(field, targetIndex);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            setSharedSelectDropdownOpen(field, false);
            parts.trigger.focus({preventScroll: true});
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            options[currentIndex]?.click();
            return;
        }
        if (event.key === "Tab") {
            setSharedSelectDropdownOpen(field, false);
        }
    };

    const brokerAlphabeticalCollator = new Intl.Collator("en-US", {sensitivity: "base", numeric: true});

    const isBrokerSharedSelectKind = (field) => {
        if (!(field instanceof HTMLElement)) return false;
        const kind = String(field.dataset.sharedSelectKind || "").trim().toLowerCase();
        return kind === "settings-broker"
            || kind === "live-trading-broker"
            || kind === "investment-import-broker";
    };

    const getBrokerOptionSortKey = (option) => {
        if (!(option instanceof HTMLOptionElement)) return "";
        const explicitKey = String(option.dataset.sortKey || "").trim().toLowerCase();
        if (explicitKey) return explicitKey;
        return String(option.textContent || option.value || "").trim().toLowerCase();
    };

    const compareBrokerOptionSortKeys = (leftKey, rightKey) => brokerAlphabeticalCollator.compare(leftKey, rightKey);

    const sortBrokerSelectOptions = (select) => {
        if (!(select instanceof HTMLSelectElement)) return;
        const selectedValue = String(select.value || "");
        const options = Array.from(select.options);
        options.sort((left, right) => {
            const bySortKey = compareBrokerOptionSortKeys(
                getBrokerOptionSortKey(left),
                getBrokerOptionSortKey(right),
            );
            if (bySortKey !== 0) return bySortKey;
            return compareBrokerOptionSortKeys(
                String(left.value || "").trim().toLowerCase(),
                String(right.value || "").trim().toLowerCase(),
            );
        });
        const fragment = document.createDocumentFragment();
        options.forEach((option) => fragment.appendChild(option));
        select.replaceChildren(fragment);
        if (selectedValue && Array.from(select.options).some((option) => option.value === selectedValue)) {
            select.value = selectedValue;
        }
    };

    const refreshSharedSelectField = (field) => {
        syncSharedSelectTriggerLabel(field);
    };

    const initializeSharedSelectField = (field) => {
        const parts = getSharedSelectParts(field);
        if (parts && isBrokerSharedSelectKind(parts.field)) {
            sortBrokerSelectOptions(parts.select);
        }
        const shouldStartOpen = Boolean(parts)
            && (!parts.dropdown.hidden || parts.field.classList.contains("is-open"))
            && parts.trigger.getAttribute("aria-expanded") === "true";
        refreshSharedSelectField(field);
        if (!parts || parts.field.dataset.sharedSelectJsBound === "1") return;
        parts.field.dataset.sharedSelectJsBound = "1";
        parts.trigger.addEventListener("click", () => {
            const shouldOpen = parts.dropdown.hidden;
            closeSharedSelectDropdowns(field);
            setTradeStrategyDropdownOpen(false);
            if (!field.closest("[data-trade-strategy-panel]")) {
                setTradeStrategyPanelOpen(false);
            }
            renderSharedSelectDropdown(field);
            setSharedSelectDropdownOpen(field, shouldOpen);
        });
        parts.trigger.addEventListener("keydown", (event) => {
            handleSharedSelectTriggerKeydown(field, event);
        });
        parts.dropdown.addEventListener("keydown", (event) => {
            handleSharedSelectDropdownKeydown(field, event);
        });
        parts.select.addEventListener("change", () => {
            syncNativeSelectSelection(parts.select, parts.select.value);
            refreshSharedSelectField(field);
            if (parts.field.dataset.sharedSelectKind === "strategy-param") {
                scheduleStrategyParamSubmit(80);
            }
        });
        if (parts.select.id === "period" && parts.select.dataset.periodChangeJsBound !== "1") {
            parts.select.dataset.periodChangeJsBound = "1";
            parts.select.addEventListener("change", handlePeriodSelectionChange);
        }
        if (shouldStartOpen) {
            renderSharedSelectDropdown(field);
            setSharedSelectDropdownOpen(field, true);
        }
    };

    const upgradeStandaloneSharedSelects = () => {
        const standaloneSelects = Array.from(document.querySelectorAll(
            "select.trade-strategy-select.form-select:not(.backtest-shared-select-native)"
        )).filter((select) => (
            select instanceof HTMLSelectElement
            && !select.closest("[data-shared-select-field]")
            && select.dataset.sharedSelectStandaloneReady !== "1"
        ));

        standaloneSelects.forEach((select) => {
            const host = select.parentElement;
            if (!(host instanceof HTMLElement)) return;

            const selectId = String(select.id || "").trim();
            const generatedId = selectId || `investment_transfer_select_${++sharedSelectOwnerSequence}`;
            const selectedOption = Array.from(select.options).find((option) => option.value === select.value);
            const selectedLabel = selectedOption?.textContent?.trim() || select.value || "";
            const field = document.createElement("div");
            field.className = "trade-strategy-row backtest-shared-select-row backtest-shared-select-field investment-transfer-link-shared-select-field";
            field.dataset.sharedSelectField = "";
            field.dataset.sharedSelectKind = "investment-transfer";

            const combobox = document.createElement("div");
            combobox.className = "trade-strategy-combobox backtest-shared-select-combobox";

            const trigger = document.createElement("button");
            trigger.type = "button";
            trigger.className = "trade-strategy-select form-select trade-strategy-trigger backtest-shared-select-trigger investment-transfer-link-select";
            trigger.dataset.sharedSelectTrigger = "";
            trigger.setAttribute("aria-haspopup", "listbox");
            trigger.setAttribute("aria-expanded", "false");
            trigger.setAttribute("aria-controls", `${generatedId}_dropdown`);
            trigger.setAttribute("aria-label", select.getAttribute("aria-label") || selectedLabel);
            trigger.title = selectedLabel;

            const triggerLabel = document.createElement("span");
            triggerLabel.className = "trade-strategy-trigger-label";
            triggerLabel.dataset.sharedSelectTriggerLabel = "";
            triggerLabel.dataset.fallbackLabel = selectedLabel;
            triggerLabel.textContent = selectedLabel;
            trigger.appendChild(triggerLabel);
            combobox.appendChild(trigger);

            const dropdown = document.createElement("div");
            dropdown.id = `${generatedId}_dropdown`;
            dropdown.className = "trade-strategy-dropdown backtest-shared-select-dropdown investment-transfer-link-dropdown";
            dropdown.dataset.sharedSelectDropdown = "";
            dropdown.setAttribute("role", "listbox");
            dropdown.setAttribute("aria-label", select.getAttribute("aria-label") || "Select an option");
            dropdown.hidden = true;

            select.classList.add("trade-strategy-native-select", "backtest-shared-select-native");
            select.hidden = false;
            select.setAttribute("aria-hidden", "true");
            select.tabIndex = -1;
            select.dataset.sharedSelectStandaloneReady = "1";

            host.replaceChild(field, select);
            field.appendChild(select);
            field.appendChild(combobox);
            field.appendChild(dropdown);
        });
    };

    const getBacktestIntervalShell = () => document.querySelector("[data-backtest-interval-shell]");
    const getBacktestIntervalInputs = () => Array.from(document.querySelectorAll("[data-backtest-interval-input]"))
        .filter((input) => input instanceof HTMLInputElement);
    const strategyDeclaresBacktestInterval = (interval) => {
        const input = getBacktestIntervalInputs().find((candidate) => candidate.value === interval);
        if (!(input instanceof HTMLInputElement)) return false;
        const declaredIntervals = Array.isArray(state.strategySupports?.execution_intervals)
            ? state.strategySupports.execution_intervals
            : [];
        return declaredIntervals.includes(interval);
    };
    const getDcaFrequencyShell = () => document.querySelector("[data-dca-frequency-shell]");
    const getDcaFrequencyInputs = () => Array.from(document.querySelectorAll("[data-dca-frequency-input]"))
        .filter((input) => input instanceof HTMLInputElement);
    const getSelectedDcaFrequency = () => {
        const selectedInput = getDcaFrequencyInputs().find((input) => input.checked && !input.disabled);
        return selectedInput?.value === "weekly" ? "weekly" : "monthly";
    };
    const getVisibleSegmentedOptions = (shell) => Array.from(shell.querySelectorAll(".segmented-control-option, .range-mode-option"))
        .filter((option) => option instanceof HTMLElement)
        .filter((option) => !option.hidden);
    const readSegmentedPixelValue = (styles, propertyName, fallback = 0) => {
        const parsedValue = Number.parseFloat(styles.getPropertyValue(propertyName));
        return Number.isFinite(parsedValue) ? parsedValue : fallback;
    };
    const getSegmentedOverflowFrame = (shell) => {
        if (!(shell instanceof HTMLElement) || shell.dataset.segmentedOverflowMode !== "peek") return null;
        const frame = shell.closest("[data-segmented-overflow-frame]");
        return frame instanceof HTMLElement ? frame : null;
    };
    const syncSegmentedOverflowState = (frame) => {
        if (!(frame instanceof HTMLElement)) return;
        const maxScrollLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
        const isOverflowing = maxScrollLeft > 1;
        frame.dataset.segmentedOverflow = isOverflowing ? "1" : "0";
        frame.dataset.overflowStart = isOverflowing && frame.scrollLeft > 1 ? "1" : "0";
        frame.dataset.overflowEnd = isOverflowing && frame.scrollLeft < maxScrollLeft - 1 ? "1" : "0";
    };
    const bindSegmentedOverflowFrame = (frame) => {
        if (!(frame instanceof HTMLElement) || frame.dataset.segmentedScrollBound === "1") return;
        frame.dataset.segmentedScrollBound = "1";
        let scrollFrame = 0;
        frame.addEventListener("scroll", () => {
            if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
            scrollFrame = window.requestAnimationFrame(() => {
                scrollFrame = 0;
                syncSegmentedOverflowState(frame);
            });
        }, {passive: true});
    };
    const syncSegmentedOverflowLayout = (shell, options) => {
        const frame = getSegmentedOverflowFrame(shell);
        if (!(frame instanceof HTMLElement)) return null;
        bindSegmentedOverflowFrame(frame);
        const shellStyles = window.getComputedStyle(shell);
        const frameStyles = window.getComputedStyle(frame);
        const optionCount = Math.max(options.length, 1);
        const frameWidth = Math.max(1, Math.floor(frame.getBoundingClientRect().width));
        const paddingLeft = Number.parseFloat(shellStyles.paddingLeft) || 0;
        const paddingRight = Number.parseFloat(shellStyles.paddingRight) || 0;
        const columnGap = Number.parseFloat(shellStyles.columnGap)
            || readSegmentedPixelValue(shellStyles, "--mode-switch-gap", 0);
        const minimumOptionWidth = Math.max(
            1,
            readSegmentedPixelValue(frameStyles, "--segmented-overflow-option-min-width", 92),
        );
        const peekWidth = Math.max(
            0,
            Math.min(
                frameWidth / 3,
                readSegmentedPixelValue(frameStyles, "--segmented-overflow-peek-size", 36),
            ),
        );
        const minimumTrackWidth = paddingLeft
            + paddingRight
            + (minimumOptionWidth * optionCount)
            + (columnGap * Math.max(0, optionCount - 1));
        const shouldOverflow = minimumTrackWidth > frameWidth + 1;
        shell.dataset.segmentedOverflow = shouldOverflow ? "1" : "0";
        frame.dataset.segmentedOverflow = shouldOverflow ? "1" : "0";
        if (!shouldOverflow) {
            shell.style.removeProperty("--segmented-option-width");
            shell.style.removeProperty("--segmented-track-width");
            shell.style.removeProperty("--segmented-visible-count");
            frame.style.removeProperty("--segmented-visible-count");
            frame.dataset.segmentedVisibleCount = String(optionCount);
            shell.style.removeProperty("width");
            shell.style.removeProperty("grid-template-columns");
            frame.scrollLeft = 0;
            syncSegmentedOverflowState(frame);
            return {frame, overflow: false, visibleCount: optionCount};
        }

        const visibleCount = Math.max(
            1,
            Math.min(
                optionCount - 1,
                Math.floor((frameWidth - paddingLeft - peekWidth + columnGap) / (minimumOptionWidth + columnGap)),
            ),
        );
        const visibleOptionsWidth = Math.max(
            minimumOptionWidth * visibleCount,
            frameWidth - paddingLeft - peekWidth - (columnGap * visibleCount),
        );
        const optionWidth = Math.max(minimumOptionWidth, visibleOptionsWidth / visibleCount);
        const trackWidth = paddingLeft
            + paddingRight
            + (optionWidth * optionCount)
            + (columnGap * Math.max(0, optionCount - 1));
        shell.style.setProperty("--segmented-option-width", `${optionWidth}px`);
        shell.style.setProperty("--segmented-track-width", `${trackWidth}px`);
        shell.style.setProperty("--segmented-visible-count", String(visibleCount));
        frame.style.setProperty("--segmented-visible-count", String(visibleCount));
        frame.dataset.segmentedVisibleCount = String(visibleCount);
        window.requestAnimationFrame(() => syncSegmentedOverflowState(frame));
        return {frame, overflow: true, visibleCount};
    };
    const keepSegmentedOptionVisible = (shell, option) => {
        const frame = getSegmentedOverflowFrame(shell);
        if (!(frame instanceof HTMLElement) || !(option instanceof HTMLElement)) return;
        const maxScrollLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
        if (maxScrollLeft <= 1) {
            frame.scrollLeft = 0;
            syncSegmentedOverflowState(frame);
            return;
        }
        const options = getVisibleSegmentedOptions(shell);
        const optionIndex = options.indexOf(option);
        const frameStyles = window.getComputedStyle(frame);
        const fadeWidth = readSegmentedPixelValue(frameStyles, "--segmented-overflow-fade-size", 0);
        const peekWidth = readSegmentedPixelValue(frameStyles, "--segmented-overflow-peek-size", 0);
        const optionLeft = option.offsetLeft;
        const optionRight = optionLeft + option.offsetWidth;
        const leftSafety = optionIndex > 0 ? fadeWidth : 0;
        const rightSafety = optionIndex >= 0 && optionIndex < options.length - 1 ? peekWidth : 0;
        let nextScrollLeft = frame.scrollLeft;
        if (optionIndex === 0) {
            nextScrollLeft = 0;
        } else if (optionIndex === options.length - 1) {
            nextScrollLeft = maxScrollLeft;
        } else if (optionLeft < frame.scrollLeft + leftSafety) {
            nextScrollLeft = optionLeft - leftSafety;
        } else if (optionRight > frame.scrollLeft + frame.clientWidth - rightSafety) {
            nextScrollLeft = optionRight - frame.clientWidth + rightSafety;
        }
        frame.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
        window.requestAnimationFrame(() => syncSegmentedOverflowState(frame));
    };
    const syncSegmentedControlLayout = (shell, {
        activeValue = "",
        activeIndex = -1,
        options = null,
    } = {}) => {
        if (!(shell instanceof HTMLElement)) return;
        const resolvedOptions = Array.isArray(options) ? options : getVisibleSegmentedOptions(shell);
        const optionCount = Math.max(resolvedOptions.length, 1);
        let resolvedActiveIndex = activeIndex;
        if (resolvedActiveIndex < 0) {
            resolvedActiveIndex = resolvedOptions.findIndex((option) => {
                const input = option.querySelector("input");
                return (input instanceof HTMLInputElement && input.checked)
                    || option.getAttribute("aria-selected") === "true";
            });
        }
        resolvedActiveIndex = Math.max(0, Math.min(optionCount - 1, resolvedActiveIndex));
        if (activeValue) shell.dataset.active = activeValue;
        shell.dataset.optionCount = String(optionCount);
        shell.style.setProperty("--segmented-option-count", String(optionCount));
        shell.style.setProperty("--segmented-active-index", String(resolvedActiveIndex));
        const overflowLayout = syncSegmentedOverflowLayout(shell, resolvedOptions);
        let shouldOverflow = Boolean(overflowLayout?.overflow);
        if (!overflowLayout) {
            shell.dataset.segmentedOverflow = "0";
            shouldOverflow = shell.scrollWidth > shell.clientWidth + 1;
            shell.dataset.segmentedOverflow = shouldOverflow ? "1" : "0";
        }
        if (shouldOverflow || shell.dataset.segmentedPill === "measured") {
            const activeOption = resolvedOptions[resolvedActiveIndex];
            if (activeOption instanceof HTMLElement) {
                const shellStyles = window.getComputedStyle(shell);
                const thumbInset = Number.parseFloat(shellStyles.getPropertyValue("--mode-switch-thumb-inset"))
                    || Number.parseFloat(shellStyles.paddingLeft)
                    || 0;
                shell.style.setProperty("--segmented-pill-left", `${Math.max(0, activeOption.offsetLeft - thumbInset)}px`);
                shell.style.setProperty("--segmented-pill-width", `${Math.max(1, activeOption.offsetWidth)}px`);
                shell.classList.add("is-pill-ready");
                keepSegmentedOptionVisible(shell, activeOption);
            }
        } else if (shell.dataset.segmentedPill !== "measured") {
            shell.classList.remove("is-pill-ready");
            shell.style.removeProperty("--segmented-pill-left");
            shell.style.removeProperty("--segmented-pill-width");
        }
    };
    const syncAllSegmentedControlLayouts = () => {
        $$(".segmented-control, .range-mode-shell").forEach((shell) => {
            if (!(shell instanceof HTMLElement)) return;
            syncSegmentedControlLayout(shell, {activeValue: shell.dataset.active || ""});
        });
    };
    window.WORTHWARD_SEGMENTED_CONTROLS = Object.freeze({
        keepOptionVisible: keepSegmentedOptionVisible,
        sync: syncSegmentedControlLayout,
        syncOverflowState: syncSegmentedOverflowState,
    });
    const syncRangeModeSegmentedControl = () => {
        const shell = $(".range-mode-shell");
        if (!(shell instanceof HTMLElement)) return;
        const options = getVisibleSegmentedOptions(shell);
        const activeInput = rangeModeInputs.find((input) => input.checked && !input.disabled);
        const activeValue = activeInput?.value || defaults.range_mode || "period";
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector("input");
            return input instanceof HTMLInputElement && input.checked;
        }));
        syncSegmentedControlLayout(shell, {activeValue, activeIndex, options});
    };

    const syncPortfolioAllocationSegmentedControl = () => {
        if (!isPortfolioView) return;
        const shell = $(".portfolio-allocation-shell");
        if (!(shell instanceof HTMLElement)) return;
        const inputs = getPortfolioAllocationInputs();
        const activeValue = getPortfolioAllocationMode();
        const activeIndex = Math.max(0, inputs.findIndex((input) => input.checked));
        syncSegmentedControlLayout(shell, {activeValue, activeIndex});
        form?.dataset && (form.dataset.portfolioAllocation = activeValue);
        if (activeValue === "shares") {
            hidePortfolioWeightTooltips();
            document.querySelectorAll(".portfolio-weight-field.is-open").forEach((field) => {
                field.classList.remove("is-open");
            });
        }
        validatePortfolioWeightInputs();
        dispatchPortfolioPreviewUpdate();
    };

    const attachPortfolioAllocationHandlers = () => {
        if (!isPortfolioView) return;
        getPortfolioAllocationInputs().forEach((input) => {
            if (input.dataset.bound === "1") return;
            input.dataset.bound = "1";
            input.addEventListener("change", () => {
                if (input.checked && input.value === "shares") {
                    getWeightFields().forEach(({tickerInput, shares}) => {
                        if (!shares || !sanitizeTicker(tickerInput?.value || "")) return;
                        const currentShares = Number.parseInt(shares.value || "0", 10) || 0;
                        if (currentShares <= 0) shares.value = "1";
                    });
                }
                syncPortfolioAllocationSegmentedControl();
                requestWorkspaceChartTransition("portfolio-allocation");
                scheduleAutoSubmit(80);
            });
        });
        syncPortfolioAllocationSegmentedControl();
    };
    const syncDcaFrequencySegmentedControl = () => {
        const shell = getDcaFrequencyShell();
        if (!(shell instanceof HTMLElement)) return;
        const options = getVisibleSegmentedOptions(shell);
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector("input");
            return input instanceof HTMLInputElement && input.checked;
        }));
        syncSegmentedControlLayout(shell, {activeValue: getSelectedDcaFrequency(), activeIndex, options});
    };
    const updateDcaSchedulePanels = () => {
        const frequency = getSelectedDcaFrequency();
        const weeklyPanel = document.getElementById("dca_weekly_panel");
        const monthlyPanel = document.getElementById("dca_monthly_panel");
        if (weeklyPanel) {
            const isWeekly = frequency === "weekly";
            weeklyPanel.hidden = !isWeekly;
            weeklyPanel.setAttribute("aria-hidden", String(!isWeekly));
            weeklyPanel.style.display = isWeekly ? "" : "none";
            if (!isWeekly) {
                closeSharedSelectDropdowns(weeklyPanel.querySelector("[data-shared-select-field]"));
                setSharedSelectDropdownOpen(weeklyPanel.querySelector("[data-shared-select-field]"), false);
            }
        }
        if (monthlyPanel) {
            const isMonthly = frequency === "monthly";
            monthlyPanel.hidden = !isMonthly;
            monthlyPanel.setAttribute("aria-hidden", String(!isMonthly));
            monthlyPanel.style.display = isMonthly ? "" : "none";
            if (!isMonthly) {
                closeSharedSelectDropdowns(monthlyPanel.querySelector("[data-shared-select-field]"));
                setSharedSelectDropdownOpen(monthlyPanel.querySelector("[data-shared-select-field]"), false);
            }
        }
    };
    const getSelectedBacktestInterval = () => {
        const selectedInput = getBacktestIntervalInputs().find((input) => input.checked && !input.disabled);
        return selectedInput?.value || "1d";
    };
    const syncBacktestIntervalSegmentedControl = () => {
        const shell = getBacktestIntervalShell();
        if (!(shell instanceof HTMLElement)) return;
        const options = getVisibleSegmentedOptions(shell);
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector("input");
            return input instanceof HTMLInputElement && input.checked;
        }));
        syncSegmentedControlLayout(shell, {activeValue: getSelectedBacktestInterval(), activeIndex, options});
    };
    const setBacktestIntervalAvailability = (has1m) => {
        getBacktestIntervalInputs().forEach((input) => {
            const option = input.closest(".segmented-control-option");
            if (!(option instanceof HTMLElement)) return;
            const isSupported = input.value !== "1m"
                || (strategyDeclaresBacktestInterval("1m") && has1m);
            input.disabled = !isSupported;
            option.hidden = !isSupported;
        });
        syncBacktestIntervalSegmentedControl();
    };
    const setBacktestIntervalValue = (value) => {
        const nextInput = getBacktestIntervalInputs().find((input) => input.value === value && !input.disabled);
        if (!(nextInput instanceof HTMLInputElement)) return false;
        if (!nextInput.checked) {
            nextInput.checked = true;
        }
        syncBacktestIntervalSegmentedControl();
        return true;
    };
    const buildUtcDate = (yearValue, monthIndexValue, dayValue) => {
        const year = Number.parseInt(yearValue, 10);
        const monthIndex = Number.parseInt(monthIndexValue, 10);
        const day = Number.parseInt(dayValue, 10);
        if (![year, monthIndex, day].every(Number.isInteger)) return null;
        const candidate = new Date(Date.UTC(year, monthIndex, day));
        if (
            candidate.getUTCFullYear() !== year
            || candidate.getUTCMonth() !== monthIndex
            || candidate.getUTCDate() !== day
        ) {
            return null;
        }
        return candidate;
    };
    const parseIsoDate = (rawValue) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rawValue || ""));
        if (!match) return null;
        return buildUtcDate(match[1], Number.parseInt(match[2], 10) - 1, match[3]);
    };

    const formatIsoDate = (date) => {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    const padTwo = (value) => String(value).padStart(2, "0");
    const readFullDateFormat = () => String(window.WORTHWARD_APP?.dateDisplay?.full || "d_mmm_yyyy");
    const readShortDateFormat = () => String(window.WORTHWARD_APP?.dateDisplay?.short || "yyyy_mm_dd");
    const buildFullDateLayout = (dateParts) => {
        if (!dateParts) return {tokens: [], wrapAfterIndex: 1};
        const year = Number(dateParts.year);
        const monthIndex = Number(dateParts.monthIndex);
        const day = Number(dateParts.day);
        const monthLabel = MONTH_ABBREVIATIONS[Math.max(0, Math.min(11, monthIndex))] || "";
        const fullFormat = readFullDateFormat();
        const paddedDay = padTwo(day);
        if (fullFormat === "dd_mmm_yyyy") {
            return {tokens: [paddedDay, monthLabel, `${year}`], wrapAfterIndex: 1};
        }
        if (fullFormat === "yyyy_mmm_d") {
            return {tokens: [`${year}`, monthLabel, `${day}`], wrapAfterIndex: 0};
        }
        if (fullFormat === "yyyy_mmm_dd") {
            return {tokens: [`${year}`, monthLabel, paddedDay], wrapAfterIndex: 0};
        }
        if (fullFormat === "yyyy_mm_dd_cjk") {
            return {tokens: [`${year}年${padTwo(monthIndex + 1)}月${paddedDay}日`], wrapAfterIndex: 0};
        }
        return {tokens: [`${day}`, monthLabel, `${year}`], wrapAfterIndex: 1};
    };
    const formatFullDateParts = (dateParts, {includeTime = false, includeSeconds = false} = {}) => {
        if (!dateParts) return "";
        const {tokens} = buildFullDateLayout(dateParts);
        const baseDate = tokens.join(" ");
        if (!includeTime) return baseDate;
        const hasHours = Number.isInteger(dateParts.hours);
        const hasMinutes = Number.isInteger(dateParts.minutes);
        if (!hasHours || !hasMinutes) return baseDate;
        const timeText = includeSeconds && Number.isInteger(dateParts.seconds)
            ? `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}:${padTwo(dateParts.seconds)}`
            : `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}`;
        return `${baseDate} ${timeText}`;
    };
    const formatShortDateParts = (dateParts) => {
        if (!dateParts) return "";
        const year = Number(dateParts.year);
        const month = Number(dateParts.monthIndex) + 1;
        const day = Number(dateParts.day);
        if (readShortDateFormat() === "dd_mm_yyyy") {
            return `${padTwo(day)}/${padTwo(month)}/${year}`;
        }
        return `${year}/${padTwo(month)}/${padTwo(day)}`;
    };
    const formatFullDateLines = (dateParts, {allowWrap = true} = {}) => {
        if (!dateParts) return ["", ""];
        if (!allowWrap) return [formatFullDateParts(dateParts), ""];
        const {tokens, wrapAfterIndex} = buildFullDateLayout(dateParts);
        const hasHours = Number.isInteger(dateParts.hours);
        const hasMinutes = Number.isInteger(dateParts.minutes);
        const firstLine = tokens.slice(0, wrapAfterIndex + 1).join(" ");
        const secondLineTokens = tokens.slice(wrapAfterIndex + 1);
        const secondLineBase = secondLineTokens.join(" ");
        if (!hasHours || !hasMinutes) return [firstLine, secondLineBase];
        const timeText = `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}`;
        return [firstLine, secondLineBase ? `${secondLineBase} ${timeText}` : timeText];
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
    const convertNewYorkWallTimeParts = (rawValue, timezone) => {
        const match = String(rawValue || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
        if (!match || !match[4] || !timezone) return null;
        const wallTimeUtcMs = Date.UTC(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4]),
            Number(match[5]),
        );
        const newYorkOffset = getTimezoneOffsetMinutes("America/New_York", wallTimeUtcMs);
        const actualUtcMs = wallTimeUtcMs - (newYorkOffset * 60000);
        const targetOffset = getTimezoneOffsetMinutes(timezone, actualUtcMs);
        const targetWallTime = new Date(actualUtcMs + (targetOffset * 60000));
        return {
            year: targetWallTime.getUTCFullYear(),
            monthIndex: targetWallTime.getUTCMonth(),
            day: targetWallTime.getUTCDate(),
            hours: targetWallTime.getUTCHours(),
            minutes: targetWallTime.getUTCMinutes(),
            offsetMinutes: targetOffset,
        };
    };
    const formatPickerMonthLabel = (date) => {
        if (!(date instanceof Date)) return "";
        const monthLabel = MONTH_LABELS[date.getUTCMonth()] || "";
        const year = date.getUTCFullYear();
        return readFullDateFormat().startsWith("yyyy_") ? `${year} ${monthLabel}` : `${monthLabel} ${year}`;
    };
    const getDateEntryExample = () => formatFullDateParts({year: 2025, monthIndex: 5, day: 5});
    const getDateEntryHint = () => getDateEntryExample();
    const getShortDatePlaceholder = () => readShortDateFormat() === "dd_mm_yyyy" ? "00/00/0000" : "0000/00/00";
    const formatDisplayDate = (rawValue) => {
        const date = parseIsoDate(rawValue);
        if (!date) return "Select date";
        return formatFullDateParts({
            year: date.getUTCFullYear(),
            monthIndex: date.getUTCMonth(),
            day: date.getUTCDate(),
        });
    };
    const parseDisplayDateTextToIso = (rawValue) => {
        const parsedDate = parseManualDateInput(String(rawValue || "").trim());
        return parsedDate ? formatIsoDate(parsedDate) : "";
    };
    const parseOneDayTradingDateTextToIso = (rawValue) => {
        const normalized = String(rawValue || "").trim();
        return parseDisplayDateTextToIso(normalized)
            || parseDisplayDateTextToIso(normalized.replace(/\s+[A-Za-z]{2,5}$/, ""));
    };
    const parseMonthToken = (rawValue) => {
        const normalized = String(rawValue || "").trim().toLowerCase().replace(/\.$/, "");
        if (!normalized) return null;
        return Number.isInteger(MONTH_TOKEN_TO_INDEX[normalized]) ? MONTH_TOKEN_TO_INDEX[normalized] : null;
    };
    const parseManualDateInput = (rawValue) => {
        const normalized = String(rawValue || "").trim().replace(/,/g, " ");
        if (!normalized) return null;
        const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(normalized);
        if (isoMatch) {
            return buildUtcDate(isoMatch[1], Number.parseInt(isoMatch[2], 10) - 1, isoMatch[3]);
        }
        const shortMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(normalized);
        if (shortMatch && readShortDateFormat() === "dd_mm_yyyy") {
            return buildUtcDate(shortMatch[3], Number.parseInt(shortMatch[2], 10) - 1, shortMatch[1]);
        }
        const tokenized = normalized.split(/\s+/);
        if (tokenized.length !== 3) return null;
        const monthIndex = parseMonthToken(tokenized[1]);
        if (!Number.isInteger(monthIndex)) return null;
        if (/^\d{4}$/.test(tokenized[0])) {
            return buildUtcDate(tokenized[0], monthIndex, tokenized[2]);
        }
        if (/^\d{4}$/.test(tokenized[2])) {
            return buildUtcDate(tokenized[2], monthIndex, tokenized[0]);
        }
        return null;
    };
    bootstrap.dateDisplay = {
        formatFullDateParts,
        formatShortDateParts,
        formatFullDateLines,
        convertNewYorkWallTimeParts,
        formatPickerMonthLabel,
        getShortDatePlaceholder,
    };
    bootstrap.currencyDisplay = {
        minorUnits(currency) {
            return new Set(["JPY", "KRW"]).has(String(currency || "").toUpperCase()) ? 0 : 2;
        },
        format(value, currency, showCurrency = true) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return "";
            const fractionDigits = this.minorUnits(currency);
            const formatted = numeric.toLocaleString("en-US", {
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits,
            });
            return showCurrency ? `${currency} ${formatted}` : formatted;
        },
        formatAxis(value, currency, showCurrency = true) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return "";
            const fractionDigits = this.minorUnits(currency);
            const formatted = numeric.toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: fractionDigits,
            });
            return showCurrency ? `${currency} ${formatted}` : formatted;
        },
    };

    const startOfMonthUtc = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const addMonthsUtc = (date, offset) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
    const isSameUtcDay = (left, right) => (
        left.getUTCFullYear() === right.getUTCFullYear()
        && left.getUTCMonth() === right.getUTCMonth()
        && left.getUTCDate() === right.getUTCDate()
    );
    const clampDateToBounds = (date, minDate, maxDate) => {
        if (minDate && date < minDate) return minDate;
        if (maxDate && date > maxDate) return maxDate;
        return date;
    };
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const PERIOD_DAY_SPANS = state.periodMetadata?.daySpans || {};
    const PERIOD_MONTH_SPANS = state.periodMetadata?.monthSpans || {};
    const PERIOD_LABELS = state.periodMetadata?.labels || {};

    const shiftMonthsUtc = (date, months) => {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
        const targetYear = targetMonthStart.getUTCFullYear();
        const targetMonth = targetMonthStart.getUTCMonth();
        const targetMonthEnd = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, targetMonthEnd)));
    };

    const diffDaysUtc = (start, end) => Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));

    const getRenderedChartDateRange = () => {
        if (["tickers", "prices"].includes(state.currentView) && periodSelect?.value === "1d") {
            const displayRangeDate = parseOneDayTradingDateTextToIso(
                $("#compare_summary_date_range, .price-compare-range")?.textContent || "",
            );
            if (displayRangeDate) {
                return {
                    start: displayRangeDate,
                    end: displayRangeDate,
                };
            }
        }
        if (
            ["tickers", "prices"].includes(state.currentView)
            && (periodSelect?.value || defaults.period) === "1d"
            && state.chart?.tradingDate
        ) {
            const tradingDate = String(state.chart.tradingDate || "");
            if (parseIsoDate(tradingDate)) {
                return {
                    start: tradingDate,
                    end: tradingDate,
                };
            }
        }
        if (isBacktestView) {
            const dates = state.backtestResult?.chart?.dates;
            if (Array.isArray(dates) && dates.length) {
                return {
                    start: String(dates[0]),
                    end: String(dates[dates.length - 1]),
                };
            }
        }
        if (isDcaView) {
            const dates = state.dcaResult?.chart?.dates;
            if (Array.isArray(dates) && dates.length) {
                return {
                    start: String(dates[0]),
                    end: String(dates[dates.length - 1]),
                };
            }
        }
        const firstSeriesDates = state.chart?.series?.[0]?.dates;
        if (Array.isArray(firstSeriesDates) && firstSeriesDates.length) {
            return {
                start: String(firstSeriesDates[0]),
                end: String(firstSeriesDates[firstSeriesDates.length - 1]),
            };
        }
        if (exactStartInput?.value && exactEndInput?.value) {
            return {
                start: exactStartInput.value,
                end: exactEndInput.value,
            };
        }
        return null;
    };

    const syncExactInputsToRenderedRange = () => {
        if (!exactStartInput || !exactEndInput) return false;
        if (isOneDayExactDateMode() && exactTradingDateInput) {
            const range = getRenderedChartDateRange();
            const summaryTradingDate = parseOneDayTradingDateTextToIso(
                $("#compare_summary_date_range, .price-compare-range")?.textContent || "",
            );
            const tradingDate = [
                summaryTradingDate,
                exactTradingDateInput.value,
                exactEndInput.value,
                exactStartInput.value,
                range?.end,
                range?.start,
            ].find((value) => parseIsoDate(String(value || "")));
            if (!tradingDate) return false;
            exactTradingDateInput.value = tradingDate;
            if (exactStartInput) exactStartInput.value = tradingDate;
            if (exactEndInput) exactEndInput.value = tradingDate;
            refreshDatePickers();
            return true;
        }
        const range = getRenderedChartDateRange();
        if (!range?.start || !range?.end) return false;
        exactStartInput.value = range.start;
        exactEndInput.value = range.end;
        refreshDatePickers();
        return true;
    };

    const chooseRelativePeriodForExactRange = () => {
        if (isOneDayExactDateMode()) return "1d";
        if (!periodSelect || !exactStartInput?.value || !exactEndInput?.value) return null;
        const exactStartDate = parseIsoDate(exactStartInput.value);
        const exactEndDate = parseIsoDate(exactEndInput.value);
        const maxDate = parseIsoDate(exactEndInput.max || exactEndInput.value);
        const minDate = parseIsoDate(exactStartInput.min || exactStartInput.value);
        if (!exactStartDate || !exactEndDate || !maxDate) return null;

        const exactDurationDays = diffDaysUtc(exactStartDate, exactEndDate);
        const availableDurationDays = minDate ? diffDaysUtc(minDate, maxDate) : exactDurationDays;
        const nonMaxOptions = Array.from(periodSelect.options)
            .map((option) => option.value)
            .filter((value) => value && value !== "max" && (PERIOD_MONTH_SPANS[value] || PERIOD_DAY_SPANS[value]));

        const intervalSelect = document.getElementById("backtest_interval");
        const currentInterval = intervalSelect ? intervalSelect.value : "1d";
        const fallbackOption = currentInterval === "1m" ? "1w" : "1y";

        if (!nonMaxOptions.length) {
            const fallbackEl = periodSelect.querySelector(`option[value="${fallbackOption}"]`);
            return fallbackEl ? fallbackOption : (periodSelect.value || null);
        }

        const candidates = nonMaxOptions.map((value) => {
            let candidateStart;
            if (PERIOD_MONTH_SPANS[value]) {
                const months = PERIOD_MONTH_SPANS[value];
                candidateStart = shiftMonthsUtc(maxDate, -months);
            } else {
                const days = PERIOD_DAY_SPANS[value];
                candidateStart = new Date(maxDate.getTime() - days * MS_PER_DAY);
            }
            const candidateDurationDays = diffDaysUtc(candidateStart, maxDate);
            const coversExactEnd = exactEndDate >= candidateStart && exactEndDate <= maxDate;
            return {
                value,
                candidateDurationDays,
                durationGap: Math.abs(candidateDurationDays - exactDurationDays),
                coveragePenalty: coversExactEnd ? 0 : 1,
            };
        });

        candidates.sort((left, right) => (
            left.durationGap - right.durationGap
            || left.coveragePenalty - right.coveragePenalty
            || left.candidateDurationDays - right.candidateDurationDays
        ));

        const longestCandidateDays = Math.max(...candidates.map((item) => item.candidateDurationDays));
        if (periodSelect.querySelector('option[value="max"]')) {
            const closeToEarliestBound = minDate && diffDaysUtc(minDate, exactStartDate) <= 3;
            if (exactDurationDays > longestCandidateDays || closeToEarliestBound || exactDurationDays >= availableDurationDays - 3) {
                return "max";
            }
        }

        return candidates[0]?.value || fallbackOption;
    };

    let lastRangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
    let hasDerivedExactDateRange = false;

    const clampTradeCapital = (value) => Math.min(1000000, Math.max(1, value || 1));
    const parseTradeCapitalValue = (rawValue) => {
        const normalized = String(rawValue || "").replace(/,/g, "").trim();
        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? clampTradeCapital(parsed) : 10000;
    };
    const formatTradeCapitalValue = (value) => new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(clampTradeCapital(value));
    const formatEditableTradeCapitalValue = (value) => {
        const normalized = clampTradeCapital(value);
        if (Math.abs(normalized - Math.round(normalized)) < 0.000001) {
            return String(Math.round(normalized));
        }
        return normalized.toFixed(2).replace(/\.?0+$/, "");
    };
    const formatTradeCapitalTypingValue = (rawValue) => {
        const normalized = String(rawValue || "").replace(/,/g, "").replace(/[^\d.]/g, "");
        const hasDecimalPoint = normalized.includes(".");
        const wholeCandidate = (normalized.split(".")[0] || "").replace(/\D/g, "");
        const decimalCandidate = (normalized.split(".")[1] || "").replace(/\D/g, "").slice(0, 2);
        const numericSource = `${wholeCandidate || "0"}${hasDecimalPoint ? `.${decimalCandidate}` : ""}`;
        const numericValue = clampTradeCapital(Number.parseFloat(numericSource) || 0);
        const [wholePart] = formatTradeCapitalValue(numericValue).split(".");
        if (hasDecimalPoint) return `${wholePart}.${decimalCandidate}`;
        return wholePart;
    };
    const countTradeCapitalCharsBeforeCaret = (value, caretPosition) => (
        String(value || "").slice(0, Math.max(0, caretPosition || 0)).replace(/,/g, "").length
    );
    const resolveTradeCapitalCaretPosition = (value, significantChars) => {
        if (significantChars <= 0) return 0;
        let seenChars = 0;
        for (let index = 0; index < value.length; index += 1) {
            if (value[index] === ",") continue;
            seenChars += 1;
            if (seenChars >= significantChars) return index + 1;
        }
        return value.length;
    };

    const updateRangePanels = () => {
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        syncRangeModeSegmentedControl();
        const isPeriodMode = rangeMode === "period";
        if (periodPanel) {
            periodPanel.hidden = !isPeriodMode;
            periodPanel.setAttribute("aria-hidden", String(!isPeriodMode));
            periodPanel.style.display = isPeriodMode ? "" : "none";
        }
        if (!isPeriodMode) {
            closeSharedSelectDropdowns(periodPanel?.querySelector("[data-shared-select-field]"));
            setSharedSelectDropdownOpen(periodPanel?.querySelector("[data-shared-select-field]"), false);
        }
        if (exactPanel) {
            exactPanel.hidden = isPeriodMode;
            exactPanel.setAttribute("aria-hidden", String(isPeriodMode));
            exactPanel.style.display = isPeriodMode ? "none" : "";
        }
        syncExactDateModeControls();
        if (isPeriodMode) closeAllDatePickers();
    };

    const canAutoSubmit = () => {
        if (!form) return false;
        const values = getFilledTickers();
        if (values.length < getMinimumRequiredTickers()) return false;
        if (new Set(values).size !== values.length) return false;
        if (isPortfolioView) {
            const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
            if (totalWeight !== 100) return false;
        }
        validateAllTickerInputs();
        if (isTickerValidationPending()) return false;
        if (getTickerInputs().some((input) => !input.checkValidity() || input.dataset.unknown === "1")) return false;
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        if (rangeModeInputs.length && rangeMode === "exact") {
            if (isOneDayExactDateMode()) {
                if (!exactTradingDateInput?.value) return false;
            } else if (!exactStartInput?.value || !exactEndInput?.value) {
                return false;
            }
        }
        return true;
    };

    const scheduleAutoSubmit = (delay = 240) => {
        if (!canAutoSubmit()) return;
        if (autoSubmitTimer) window.clearTimeout(autoSubmitTimer);
        autoSubmitTimer = window.setTimeout(() => {
			if (isSubmittingWithOverlay) {
				scheduleAutoSubmit(80);
				return;
			}
			if (!canAutoSubmit()) return;
            form.requestSubmit();
        }, delay);
    };

    function handlePeriodSelectionChange() {
        refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
        syncExactDateModeControls();
        syncOneDayExtendedHoursSwitch();
        syncDividendModeSwitches();
        if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("period");

        // Period is an explicit calculation request. Submit through the canonical
        // handler so cold ticker validation can resolve before navigation.
        if (form && !isSubmittingWithOverlay) {
            form.requestSubmit();
        }
    }

    const closeAllDatePickers = () => {
        datePickerState.forEach((picker) => {
            picker.popover.hidden = true;
            picker.trigger.setAttribute("aria-expanded", "false");
            picker.view = "days";
            picker.stablePosition = null;
        });
        syncDatePickerPeerHighlight();
    };

    const isInsideDatePicker = (picker, target) => (
        Boolean(target)
        && (picker.wrapper.contains(target) || picker.popover.contains(target))
    );

    const isInsideAnyDatePicker = (target) => (
        datePickerState.some((picker) => isInsideDatePicker(picker, target))
    );

    const positionDatePickerPopover = (picker) => {
        if (picker.stableFrame && picker.stablePosition) {
            picker.popover.style.top = `${picker.stablePosition.top}px`;
            picker.popover.style.left = `${picker.stablePosition.left}px`;
            return;
        }
        const triggerRect = picker.trigger.getBoundingClientRect();
        const visualViewport = window.visualViewport;
        const viewportLeft = visualViewport?.offsetLeft || 0;
        const viewportTop = visualViewport?.offsetTop || 0;
        const viewportWidth = visualViewport?.width || window.innerWidth;
        const viewportHeight = visualViewport?.height || window.innerHeight;
        const viewportPadding = 12;
        const popoverGap = 8;
        const popoverRect = picker.popover.getBoundingClientRect();
        const popoverWidth = Math.min(320, viewportWidth - (viewportPadding * 2));
        const popoverHeight = Math.min(
            picker.popover.offsetHeight || popoverRect.height,
            viewportHeight - (viewportPadding * 2),
        );
        const leftBoundary = viewportLeft + viewportPadding;
        const topBoundary = viewportTop + viewportPadding;
        const rightBoundary = viewportLeft + viewportWidth - viewportPadding;
        const bottomBoundary = viewportTop + viewportHeight - viewportPadding;
        const maxLeft = Math.max(leftBoundary, rightBoundary - popoverWidth);
        const maxTop = Math.max(topBoundary, bottomBoundary - popoverHeight);
        const spaceRight = rightBoundary - triggerRect.right - popoverGap;
        const spaceLeft = triggerRect.left - leftBoundary - popoverGap;
        const spaceBelow = bottomBoundary - triggerRect.bottom - popoverGap;
        const spaceAbove = triggerRect.top - topBoundary - popoverGap;
        let preferredTop = triggerRect.bottom + popoverGap;
        if (spaceBelow < popoverHeight && spaceAbove > spaceBelow) {
            preferredTop = triggerRect.top - popoverGap - popoverHeight;
        }
        const sidebarPicker = picker.wrapper.closest(".sidebar-form");
        const canOpenBeside = Boolean(sidebarPicker || picker.avoidSelector);
        const canOpenRight = canOpenBeside && spaceRight >= popoverWidth;
        const canOpenLeft = canOpenBeside && spaceLeft >= popoverWidth;
        let top = Math.min(
            Math.max(canOpenRight || canOpenLeft ? triggerRect.top : preferredTop, topBoundary),
            maxTop,
        );
        let preferredLeft = triggerRect.left;
        if (canOpenRight) {
            preferredLeft = triggerRect.right + popoverGap;
        } else if (canOpenLeft) {
            preferredLeft = triggerRect.left - popoverGap - popoverWidth;
        }
        const left = Math.min(Math.max(preferredLeft, leftBoundary), maxLeft);
        const avoidElements = picker.avoidSelector
            ? Array.from(document.querySelectorAll(picker.avoidSelector)).filter(
                (element) => element instanceof HTMLElement,
            )
            : [];
        avoidElements.forEach((avoidElement) => {
            const avoidRect = avoidElement.getBoundingClientRect();
            const overlapsHorizontally = left < avoidRect.right
                && (left + popoverWidth) > avoidRect.left;
            const overlapsVertically = top < avoidRect.bottom
                && (top + popoverHeight) > avoidRect.top;
            if (overlapsHorizontally && overlapsVertically) {
                const avoidAboveTop = Math.max(
                    topBoundary,
                    avoidRect.top - popoverGap - popoverHeight,
                );
                const avoidBelowTop = Math.min(maxTop, avoidRect.bottom + popoverGap);
                const canAvoidAbove = (avoidAboveTop + popoverHeight) <= avoidRect.top;
                const canAvoidBelow = avoidBelowTop >= avoidRect.bottom;
                if (canAvoidAbove || canAvoidBelow) {
                    top = canAvoidAbove && (!canAvoidBelow || Math.abs(top - avoidAboveTop) <= Math.abs(top - avoidBelowTop))
                        ? avoidAboveTop
                        : avoidBelowTop;
                }
            }
        });
        const roundedTop = Math.round(top);
        const roundedLeft = Math.round(left);
        picker.popover.style.top = `${roundedTop}px`;
        picker.popover.style.left = `${roundedLeft}px`;
        if (picker.stableFrame) {
            picker.stablePosition = {top: roundedTop, left: roundedLeft};
        }
    };

    const lockDatePickerPopoverFrame = (picker) => {
        if (!picker.stableFrame) return;
        picker.popover.style.height = "";
        const naturalHeight = picker.popover.offsetHeight;
        if (!Number.isFinite(naturalHeight) || naturalHeight <= 0) return;
        picker.popover.style.height = `${naturalHeight}px`;
    };

    const getDatePickerPeer = (picker) => {
        if (!picker?.role) return null;
        const peerRole = picker.role === "start" ? "end" : picker.role === "end" ? "start" : "";
        if (!peerRole) return null;
        return datePickerState.find((candidate) => (
            candidate.role === peerRole
            && candidate.group === picker.group
        )) || null;
    };

    const syncDatePickerPeerHighlight = () => {
        datePickerState.forEach((picker) => {
            picker.wrapper.classList.remove("is-peer-highlight");
        });
        const activePicker = datePickerState.find((picker) => !picker.popover.hidden);
        const peerPicker = activePicker ? getDatePickerPeer(activePicker) : null;
        if (peerPicker) {
            peerPicker.wrapper.classList.add("is-peer-highlight");
        }
    };

    const getDatePickerBounds = (picker) => ({
        minDate: parseIsoDate(picker.input.min),
        maxDate: parseIsoDate(picker.input.max),
    });

    const getDatePickerBoundMessage = (bound) => {
        const detail = dateConstraintAvailability?.[bound]?.message;
        if (detail) return detail;
        if (bound === "earliest") return "Choose a later shared trading date for the selected tickers.";
        return "Choose an earlier shared trading date for the selected tickers.";
    };

    const getDatePickerDateAvailability = (picker, candidateDate, peerDate = null) => {
        const {minDate, maxDate} = getDatePickerBounds(picker);
        const isoValue = formatIsoDate(candidateDate);
        if (minDate && candidateDate < minDate) {
            return {selectable: false, message: getDatePickerBoundMessage("earliest")};
        }
        if (maxDate && candidateDate > maxDate) {
            return {selectable: false, message: getDatePickerBoundMessage("latest")};
        }
        if (picker.role === "start" && peerDate && candidateDate > peerDate) {
            return {selectable: false, message: `${labels.start} must be on or before ${labels.to}.`};
        }
        if (picker.role === "end" && peerDate && candidateDate < peerDate) {
            return {selectable: false, message: `${labels.to} must be on or after ${labels.start}.`};
        }
        if (!picker.unconstrained && validTradingDateSet && !validTradingDateSet.has(isoValue)) {
            return {
                selectable: false,
                message: `${formatDisplayDate(isoValue)} is not a shared trading day for the selected tickers.`,
            };
        }
        return {selectable: true, message: ""};
    };

    const getDatePickerMonthAvailability = (picker, year, monthIndex, peerDate) => {
        const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
        let fallbackMessage = "";
        for (let day = 1; day <= lastDay; day += 1) {
            const availability = getDatePickerDateAvailability(
                picker,
                new Date(Date.UTC(year, monthIndex, day)),
                peerDate,
            );
            if (availability.selectable) return availability;
            if (!fallbackMessage) fallbackMessage = availability.message;
        }
        return {selectable: false, message: fallbackMessage || "No shared trading days are available in this month."};
    };

    const showDatePickerFeedback = (picker, message) => {
        picker.interactionMessage = message;
        applyDatePickerValidationState(picker);
    };

    const clearDatePickerFeedback = (picker) => {
        picker.interactionMessage = "";
    };

    const normalizeDatePickerDraft = (rawValue) => String(rawValue || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const getDatePickerComparableIsoValue = (picker) => {
        if (!picker) return "";
        const rawDraft = normalizeDatePickerDraft(picker.draftText);
        if (!rawDraft) return String(picker.input?.value || "");
        const parsedDate = parseManualDateInput(rawDraft);
        return parsedDate ? formatIsoDate(parsedDate) : String(picker.input?.value || "");
    };

    const getDatePickerWorkingState = (picker) => {
        const rawDraft = normalizeDatePickerDraft(picker.draftText);
        if (rawDraft) {
            const parsedDate = parseManualDateInput(rawDraft);
            if (!parsedDate) {
                return {
                    displayText: rawDraft,
                    previewDate: null,
                    previewIsoValue: "",
                    validationMessage: String(picker.validationMessage || ""),
                };
            }
            const previewIsoValue = formatIsoDate(parsedDate);
            return {
                displayText: rawDraft,
                previewDate: parsedDate,
                previewIsoValue,
                validationMessage: String(picker.validationMessage || ""),
            };
        }
        const selectedMonthMatch = String(picker.selectedMonthValue || "").match(/^(\d{4})-(\d{2})$/);
        if (selectedMonthMatch) {
            const selectedMonthDate = new Date(Date.UTC(
                Number.parseInt(selectedMonthMatch[1], 10),
                Number.parseInt(selectedMonthMatch[2], 10) - 1,
                1,
            ));
            return {
                displayText: formatPickerMonthLabel(selectedMonthDate),
                previewDate: null,
                previewIsoValue: "",
                validationMessage: String(picker.validationMessage || ""),
            };
        }
        const committedIsoValue = String(picker.input.value || "");
        return {
            displayText: committedIsoValue ? formatDisplayDate(committedIsoValue) : "",
            previewDate: parseIsoDate(committedIsoValue),
            previewIsoValue: committedIsoValue,
            validationMessage: String(picker.validationMessage || ""),
        };
    };

    const syncDatePickerEditorText = (picker, nextText, {force = false} = {}) => {
        if (!picker.triggerValue) return;
        const normalizedNextText = String(nextText || "");
        picker.triggerValue.dataset.empty = normalizedNextText ? "0" : "1";
        if (!force && document.activeElement === picker.triggerValue) return;
        if (picker.triggerValue.textContent !== normalizedNextText) {
            picker.triggerValue.textContent = normalizedNextText;
        }
    };

    const getDatePickerDefaultFeedback = (picker, workingState) => {
        if (picker.guidance !== "single-day-or-month" || !picker.visibleMonth) {
            return String(picker.defaultFeedback || "");
        }
        const monthLabel = formatPickerMonthLabel(picker.visibleMonth);
        const selectedLabel = String(workingState?.displayText || "").trim();
        if (picker.view === "months") {
            if (picker.selectedMonthValue && selectedLabel) {
                return `${selectedLabel} selected. Choose another calendar month.`;
            }
            return `Choose a calendar month in ${picker.visibleMonth.getUTCFullYear()}.`;
        }
        if (picker.input.value && selectedLabel) {
            return `${selectedLabel} selected. Choose another day, or select ${monthLabel} for a whole month.`;
        }
        return `Choose a day, or select ${monthLabel} for a whole month.`;
    };

    const applyDatePickerValidationState = (picker, workingState = getDatePickerWorkingState(picker)) => {
        const validationMessage = String(workingState.validationMessage || "");
        const message = validationMessage
            || String(picker.interactionMessage || "")
            || getDatePickerDefaultFeedback(picker, workingState);
        syncDatePickerEditorText(picker, workingState.displayText, {force: Boolean(picker.forceDisplaySync)});
        picker.forceDisplaySync = false;
        picker.trigger.classList.toggle("is-invalid", Boolean(validationMessage));
        picker.triggerValue.classList.toggle("is-invalid", Boolean(validationMessage));
        picker.triggerValue.setAttribute("aria-invalid", validationMessage ? "true" : "false");
        if (picker.feedback) picker.feedback.textContent = message;
    };

    const getDatePickerValidationMessage = (picker, isoValue) => {
        if (!isoValue) return "Enter a date.";
        const selectedDate = parseIsoDate(isoValue);
        if (!selectedDate) return `Enter a valid date like ${getDateEntryHint()}.`;
        const minDate = parseIsoDate(picker.input.min);
        const maxDate = parseIsoDate(picker.input.max);
        if (minDate && selectedDate < minDate) {
            return `Choose a date on or after ${formatDisplayDate(picker.input.min)}.`;
        }
        if (maxDate && selectedDate > maxDate) {
            return `Choose a date on or before ${formatDisplayDate(picker.input.max)}.`;
        }
        const peerPicker = getDatePickerPeer(picker);
        const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
        if (picker.role === "start" && peerDate && selectedDate > peerDate) {
            return `${labels.start} must be on or before ${labels.to}.`;
        }
        if (picker.role === "end" && peerDate && selectedDate < peerDate) {
            return `${labels.to} must be on or after ${labels.start}.`;
        }
        if (!picker.unconstrained && validTradingDateSet && !validTradingDateSet.has(isoValue)) {
            return "Choose a shared trading day for the selected tickers.";
        }
        return "";
    };

    const updateDatePickerValue = (picker, isoValue, {emitChange = false, closePopover = false} = {}) => {
        const previousValue = String(picker.input.value || "");
        picker.selectedMonthValue = "";
        picker.draftText = "";
        picker.validationMessage = "";
        clearDatePickerFeedback(picker);
        picker.input.value = isoValue;
        picker.forceSyncMonth = true;
        picker.forceDisplaySync = true;
        refreshDatePickers();
        if (closePopover) closeAllDatePickers();
        if (emitChange && picker.input.value !== previousValue) {
            picker.input.dispatchEvent(new Event("change", {bubbles: true}));
        }
    };

    const commitDatePickerTextInput = (picker, {emitChange = false, closePopover = false} = {}) => {
        clearDatePickerFeedback(picker);
        const previousValue = String(picker.input.value || "");
        const rawValue = normalizeDatePickerDraft(picker.triggerValue.textContent);
        if (!rawValue) {
            picker.selectedMonthValue = "";
            picker.draftText = "";
            picker.validationMessage = "Enter a date.";
            picker.input.value = "";
            picker.forceSyncMonth = true;
            picker.forceDisplaySync = true;
            refreshDatePickers();
            if (emitChange && picker.input.value !== previousValue) {
                picker.input.dispatchEvent(new Event("change", {bubbles: true}));
            }
            return;
        }
        const parsedDate = parseManualDateInput(rawValue);
        if (!parsedDate) {
            picker.draftText = rawValue;
            picker.validationMessage = `Enter a valid date like ${getDateEntryHint()}.`;
            picker.input.value = "";
            picker.forceSyncMonth = true;
            refreshDatePickers();
            if (emitChange && picker.input.value !== previousValue) {
                picker.input.dispatchEvent(new Event("change", {bubbles: true}));
            }
            return;
        }
        const isoValue = formatIsoDate(parsedDate);
        const validationMessage = getDatePickerValidationMessage(picker, isoValue);
        if (validationMessage) {
            picker.draftText = rawValue;
            picker.validationMessage = "";
            showDatePickerFeedback(picker, validationMessage);
            picker.input.value = "";
            picker.forceSyncMonth = true;
            refreshDatePickers();
            if (emitChange && picker.input.value !== previousValue) {
                picker.input.dispatchEvent(new Event("change", {bubbles: true}));
            }
            return;
        }
        updateDatePickerValue(picker, isoValue, {emitChange, closePopover});
    };

    const getDatePickerNavigationTarget = (picker, delta) => {
        if (picker.view === "months") {
            return new Date(Date.UTC(picker.visibleMonth.getUTCFullYear() + delta, 0, 1));
        }
        return addMonthsUtc(picker.visibleMonth, delta);
    };

    const getDatePickerNavigationAvailability = (picker, delta) => {
        const targetMonth = getDatePickerNavigationTarget(picker, delta);
        const peerPicker = getDatePickerPeer(picker);
        const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
        if (picker.view === "months") {
            const {minDate, maxDate} = getDatePickerBounds(picker);
            const targetYear = targetMonth.getUTCFullYear();
            return {
                selectable: !(minDate && targetYear < minDate.getUTCFullYear())
                    && !(maxDate && targetYear > maxDate.getUTCFullYear()),
                message: minDate && targetYear < minDate.getUTCFullYear()
                    ? getDatePickerBoundMessage("earliest")
                    : maxDate && targetYear > maxDate.getUTCFullYear()
                        ? getDatePickerBoundMessage("latest")
                        : "",
            };
        }
        return getDatePickerMonthAvailability(
            picker,
            targetMonth.getUTCFullYear(),
            targetMonth.getUTCMonth(),
            peerDate,
        );
    };

    const syncDatePickerNavigationButtons = (picker) => {
        picker.navButtons.forEach((button) => {
            const direction = Number.parseInt(button.dataset.dateNav || "0", 10);
            const availability = getDatePickerNavigationAvailability(picker, direction);
            const periodLabel = picker.view === "months" ? "year" : "month";
            button.classList.toggle("is-disabled", !availability.selectable);
            button.dataset.selectable = availability.selectable ? "true" : "false";
            button.removeAttribute("aria-disabled");
            button.setAttribute(
                "aria-label",
                `${direction < 0 ? "Previous" : "Next"} ${periodLabel}${availability.selectable ? "" : ", unavailable; select to learn why"}`,
            );
        });
    };

    const renderDatePickerMonthGrid = (picker, selectedDate, peerDate) => {
        const year = picker.visibleMonth.getUTCFullYear();
        picker.monthGrid.innerHTML = "";
        for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
            const availability = getDatePickerMonthAvailability(picker, year, monthIndex, peerDate);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "date-picker-month";
            const monthDate = new Date(Date.UTC(year, monthIndex, 1));
            const monthValue = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
            if (
                picker.selectedMonthValue === monthValue
                || (selectedDate && selectedDate.getUTCFullYear() === year && selectedDate.getUTCMonth() === monthIndex)
            ) {
                button.classList.add("is-selected");
            }
            if (isSameUtcDay(startOfMonthUtc(new Date()), monthDate)) button.classList.add("is-current");
            if (!availability.selectable) button.classList.add("is-disabled");
            button.textContent = MONTH_ABBREVIATIONS[monthIndex];
            button.dataset.monthValue = monthValue;
            button.dataset.selectable = availability.selectable ? "true" : "false";
            button.removeAttribute("aria-disabled");
            button.setAttribute("aria-label", `${MONTH_LABELS[monthIndex]} ${year}${availability.selectable ? "" : ", unavailable; select to learn why"}`);
            button.addEventListener("click", (event) => {
                if (!availability.selectable) {
                    showDatePickerFeedback(picker, availability.message);
                    return;
                }
                clearDatePickerFeedback(picker);
                if (picker.selectMonth) {
                    event.stopPropagation();
                    picker.selectedMonthValue = monthValue;
                    picker.input.value = "";
                    picker.draftText = "";
                    picker.validationMessage = "";
                    picker.forceDisplaySync = true;
                    syncDatePickerView(picker);
                    picker.input.dispatchEvent(new CustomEvent("worthward:date-picker-month-select", {
                        bubbles: true,
                        detail: {value: monthValue},
                    }));
                    positionDatePickerPopover(picker);
                    return;
                }
                picker.visibleMonth = monthDate;
                picker.view = "days";
                picker.forceSyncMonth = false;
                syncDatePickerView(picker);
                positionDatePickerPopover(picker);
            });
            picker.monthGrid.appendChild(button);
        }
    };

    const syncDatePickerView = (picker) => {
        const workingState = getDatePickerWorkingState(picker);
        const selectedDate = workingState.previewDate;
        const {minDate, maxDate} = getDatePickerBounds(picker);
        const peerPicker = getDatePickerPeer(picker);
        const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
        const selectedMonthDate = parseIsoDate(`${picker.selectedMonthValue || ""}-01`);
        const today = startOfMonthUtc(new Date());
        const anchorDate = selectedDate
            || selectedMonthDate
            || clampDateToBounds(parseIsoDate(picker.input.value) || minDate || maxDate || today, minDate, maxDate);
        const hasPreviewValidationMessage = Boolean(workingState.validationMessage && selectedDate);
        if (!picker.visibleMonth || picker.forceSyncMonth) {
            picker.visibleMonth = startOfMonthUtc(anchorDate);
            picker.forceSyncMonth = false;
        }
        const monthView = picker.view === "months";
        applyDatePickerValidationState(picker, workingState);
        picker.monthLabel.textContent = monthView
            ? String(picker.visibleMonth.getUTCFullYear())
            : formatPickerMonthLabel(picker.visibleMonth);
        picker.title.setAttribute(
            "aria-label",
            monthView
                ? `Return to ${formatPickerMonthLabel(picker.visibleMonth)}`
                : `Choose month and year, currently ${formatPickerMonthLabel(picker.visibleMonth)}`,
        );
        picker.calendar.hidden = monthView;
        picker.monthGrid.hidden = !monthView;
        picker.popover.classList.toggle("is-month-view", monthView);
        syncDatePickerNavigationButtons(picker);
        if (monthView) {
            renderDatePickerMonthGrid(picker, selectedDate, peerDate);
            return;
        }

        picker.grid.innerHTML = "";
        const firstDay = startOfMonthUtc(picker.visibleMonth);
        const monthStartOffset = firstDay.getUTCDay();
        const gridStart = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1 - monthStartOffset));
        for (let offset = 0; offset < 42; offset += 1) {
            const cellDate = new Date(Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), gridStart.getUTCDate() + offset));
            const isoValue = formatIsoDate(cellDate);
            const availability = getDatePickerDateAvailability(picker, cellDate, peerDate);
            const isCurrentMonth = cellDate.getUTCMonth() === picker.visibleMonth.getUTCMonth();
            const isPeerBoundary = peerDate && isSameUtcDay(cellDate, peerDate);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "date-picker-day";
            if (!isCurrentMonth) button.classList.add("is-muted");
            if (!availability.selectable) button.classList.add("is-disabled");
            if (selectedDate && isSameUtcDay(cellDate, selectedDate)) {
                button.classList.add(hasPreviewValidationMessage ? "is-preview-invalid" : "is-selected");
            }
            if (isPeerBoundary) button.classList.add("is-peer-boundary");
            if (isSameUtcDay(cellDate, new Date())) button.classList.add("is-today");
            button.textContent = String(cellDate.getUTCDate());
            button.dataset.value = isoValue;
            button.dataset.selectable = availability.selectable ? "true" : "false";
            button.removeAttribute("aria-disabled");
            button.setAttribute("aria-label", `${formatDisplayDate(isoValue)}${availability.selectable ? "" : ", unavailable; select to learn why"}`);
            button.addEventListener("click", (event) => {
                if (!availability.selectable) {
                    showDatePickerFeedback(picker, availability.message);
                    return;
                }
                if (picker.keepOpenOnSelect) event.stopPropagation();
                updateDatePickerValue(picker, isoValue, {
                    emitChange: true,
                    closePopover: !picker.keepOpenOnSelect,
                });
            });
            picker.grid.appendChild(button);
        }
    };

    const getDatePickerWrappers = (root = document) => {
        if (root instanceof HTMLElement) {
            return [
                ...(root.matches("[data-date-picker]") ? [root] : []),
                ...root.querySelectorAll("[data-date-picker]"),
            ];
        }
        return Array.from(root?.querySelectorAll?.("[data-date-picker]") || []);
    };

    const disposeDatePickers = (root = document) => {
        for (let index = datePickerState.length - 1; index >= 0; index -= 1) {
            const picker = datePickerState[index];
            const belongsToRoot = root instanceof Document
                || (root instanceof HTMLElement && root.contains(picker.wrapper));
            if (!belongsToRoot) continue;
            picker.popover.remove();
            delete picker.wrapper.dataset.bound;
            delete picker.wrapper._worthwardDatePicker;
            datePickerState.splice(index, 1);
        }
        syncDatePickerPeerHighlight();
    };

    const initializeDatePickers = (root = document) => {
        getDatePickerWrappers(root).forEach((wrapper) => {
            if (wrapper.dataset.bound === "1") return;
            const input = wrapper.querySelector('input[type="hidden"]');
            const trigger = wrapper.querySelector("[data-date-trigger]");
            const triggerValue = wrapper.querySelector("[data-date-trigger-value]");
            const popover = wrapper.querySelector("[data-date-popover]");
            const feedback = wrapper.querySelector("[data-date-feedback]");
            const title = wrapper.querySelector("[data-date-title]");
            const monthLabel = wrapper.querySelector("[data-date-month]");
            const grid = wrapper.querySelector("[data-date-grid]");
            const calendar = wrapper.querySelector("[data-date-calendar]");
            const monthGrid = wrapper.querySelector("[data-date-month-grid]");
            const navButtons = Array.from(popover.querySelectorAll("[data-date-nav]"));
            if (!input || !trigger || !triggerValue || !popover || !feedback || !title || !monthLabel || !grid || !calendar || !monthGrid) return;
            const picker = {
                wrapper,
                input,
                trigger,
                triggerValue,
                popover,
                feedback,
                title,
                monthLabel,
                grid,
                calendar,
                monthGrid,
                navButtons,
                role: wrapper.dataset.dateRole || "",
                group: wrapper.dataset.datePickerGroup || "workspace",
                unconstrained: wrapper.dataset.datePickerUnconstrained === "true",
                view: "days",
                visibleMonth: null,
                forceSyncMonth: true,
                forceDisplaySync: true,
                draftText: "",
                validationMessage: "",
                interactionMessage: "",
                defaultFeedback: wrapper.dataset.datePickerDefaultFeedback || "",
                guidance: wrapper.dataset.datePickerGuidance || "",
                keepOpenOnSelect: wrapper.dataset.datePickerKeepOpenOnSelect === "true",
                selectMonth: wrapper.dataset.datePickerSelectMonth === "true",
                stableFrame: wrapper.dataset.datePickerStableFrame === "true",
                stablePosition: null,
                avoidSelector: wrapper.dataset.datePickerAvoidSelector || "",
                selectedMonthValue: "",
            };
            wrapper.dataset.bound = "1";
            wrapper._worthwardDatePicker = picker;
            // Ensure popover is not clipped by sidebar or parents with overflow/transform.
            // NOTE: nav buttons are inside the popover, so bind nav listeners BEFORE moving the popover.
            navButtons.forEach((button) => {
                button.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const direction = Number.parseInt(button.dataset.dateNav || "0", 10);
                    const availability = getDatePickerNavigationAvailability(picker, direction);
                    if (!availability.selectable) {
                        showDatePickerFeedback(picker, availability.message);
                        return;
                    }
                    clearDatePickerFeedback(picker);
                    picker.forceSyncMonth = false;
                    picker.visibleMonth = getDatePickerNavigationTarget(picker, direction);
                    syncDatePickerView(picker);
                    positionDatePickerPopover(picker);
                });
            });
            title.addEventListener("click", (event) => {
                event.preventDefault();
                picker.view = picker.view === "months" ? "days" : "months";
                clearDatePickerFeedback(picker);
                syncDatePickerView(picker);
                positionDatePickerPopover(picker);
            });
            if (popover.parentElement !== document.body) {
                document.body.appendChild(popover);
            }
            datePickerState.push(picker);
            syncDatePickerView(picker);
            const openDatePicker = ({focusEditor = false} = {}) => {
                if (popover.hidden) {
                    closeAllDatePickers();
                }
                picker.view = "days";
                clearDatePickerFeedback(picker);
                picker.forceSyncMonth = true;
                syncDatePickerView(picker);
                popover.hidden = false;
                trigger.setAttribute("aria-expanded", "true");
                syncDatePickerPeerHighlight();
                picker.stablePosition = null;
                lockDatePickerPopoverFrame(picker);
                positionDatePickerPopover(picker);
                if (focusEditor) picker.triggerValue.focus();
            };
            trigger.addEventListener("click", () => {
                openDatePicker();
            });
            triggerValue.addEventListener("focus", () => {
                openDatePicker();
            });
            triggerValue.addEventListener("input", () => {
                picker.draftText = normalizeDatePickerDraft(triggerValue.textContent);
                picker.validationMessage = "";
                const parsedDraft = parseManualDateInput(picker.draftText);
                const draftMessage = parsedDraft
                    ? getDatePickerValidationMessage(picker, formatIsoDate(parsedDraft))
                    : "";
                if (draftMessage) showDatePickerFeedback(picker, draftMessage);
                else clearDatePickerFeedback(picker);
                triggerValue.dataset.empty = picker.draftText ? "0" : "1";
                picker.forceSyncMonth = true;
                refreshDatePickers();
            });
            triggerValue.addEventListener("blur", (event) => {
                if (isInsideDatePicker(picker, event.relatedTarget)) return;
                commitDatePickerTextInput(picker, {emitChange: true});
            });
            triggerValue.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    commitDatePickerTextInput(picker, {
                        emitChange: true,
                        closePopover: !picker.keepOpenOnSelect,
                    });
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    if (picker.view === "months") {
                        picker.view = "days";
                        syncDatePickerView(picker);
                        positionDatePickerPopover(picker);
                        return;
                    }
                    picker.draftText = "";
                    picker.validationMessage = "";
                    picker.forceDisplaySync = true;
                    syncDatePickerView(picker);
                    closeAllDatePickers();
                    triggerValue.blur();
                }
            });
            input.addEventListener("change", () => {
                picker.selectedMonthValue = "";
                picker.forceSyncMonth = true;
                picker.forceDisplaySync = true;
                picker.draftText = "";
                picker.validationMessage = "";
                clearDatePickerFeedback(picker);
                syncDatePickerView(picker);
                syncDatePickerPeerHighlight();
            });
        });
        if (!datePickerDocumentListenersBound) {
            datePickerDocumentListenersBound = true;
            document.addEventListener("pointerdown", (event) => {
                if (isInsideAnyDatePicker(event.target)) return;
                closeAllDatePickers();
            }, {capture: true});
            window.addEventListener("resize", () => {
                datePickerState.forEach((picker) => {
                    if (picker.popover.hidden) return;
                    picker.stablePosition = null;
                    positionDatePickerPopover(picker);
                });
            });
        }
    };

    const refreshDatePickers = () => {
        datePickerState.forEach((picker) => syncDatePickerView(picker));
        syncDatePickerPeerHighlight();
    };

    window.WORTHWARD_DATE_PICKERS = {
        closeAll: closeAllDatePickers,
        dispose: disposeDatePickers,
        initialize: initializeDatePickers,
        refresh: refreshDatePickers,
    };

    const buildCleanWorkspaceUrl = () => {
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        if (typeof workspaceUrlState?.buildWorkspaceUrl !== "function") return window.location.pathname;

        const strategySelect = $("#trade_strategy");
        const strategyValue = strategySelect?.value
            || document.querySelector("input[name='strategy']")?.value
            || "";
        const strategyParamDefaults = {};
        $$('[data-strategy-param-key]').forEach((field) => {
            const key = field.dataset.strategyParamKey?.trim();
            const control = field.querySelector("[data-strategy-param-input]");
            if (key && control?.dataset.default !== undefined) {
                if (control.dataset.strategyParamInput === "boolean") {
                    const defaultValue = control.dataset.default.trim().toLowerCase();
                    const isDefaultOn = ["1", "true", "on"].includes(defaultValue);
                    strategyParamDefaults[key] = isDefaultOn
                        ? control.dataset.switchOnValue
                        : control.dataset.switchOffValue;
                } else {
                    strategyParamDefaults[key] = control.dataset.default;
                }
            }
        });
        const currentUrlState = workspaceUrlState.parseWorkspaceUrlState(window.location.href, {
            defaultPeriod: defaults.period || "1y",
        });
        const activePeriod = $("#period")?.value || defaults.period || "1y";
        const rangeState = {
            rangeMode,
            period: activePeriod,
            date: isOneDayExactDateMode() ? exactTradingDateInput?.value || "" : "",
            from: isOneDayExactDateMode() ? "" : exactStartInput?.value || "",
            to: isOneDayExactDateMode() ? "" : exactEndInput?.value || "",
        };
        const portfolioEntries = getFilledWeightEntries();
        const activeTab = $("[data-trade-detail-shell] input[name='trade_detail_tab']:checked")?.value || "metrics";
        return workspaceUrlState.buildWorkspaceUrl(window.location.href, {
            ...rangeState,
            tickers: getFilledTickers(),
            comparisonMetric: state.currentView === "prices" ? getComparisonMetric() : "price",
            defaultTickers: state.currentView === "portfolio"
                ? (defaults.portfolio_tickers || [])
                : isBacktestView || isDcaView
                    ? isBacktestView
                        ? (Array.isArray(state.strategyDefaultTickers) && state.strategyDefaultTickers.length
                            ? state.strategyDefaultTickers
                            : [defaults.backtest_ticker || defaults.ticker_a || ""])
                        : [defaults.dca_ticker || defaults.ticker_a || ""]
                    : [defaults.ticker_a || "QQQ", defaults.ticker_b || "JEPQ"],
            returnMode: priceOnlyInput?.checked ? "price" : includeDividendsInput?.checked ? "dividends" : "total",
            extendedHours: Boolean(extendedHoursInput?.checked && !extendedHoursInput.disabled),
            overnight: Boolean(overnightInput?.checked && !overnightInput.disabled),
            showChips: Boolean(
                state.currentView === "prices"
                && getComparisonMetric() === "price"
                && chipsInput?.checked
                && !chipsInput.disabled,
            ),
            isPortfolio: isPortfolioView,
            allocation: isPortfolioView ? getPortfolioAllocationMode() : "weight",
            weights: portfolioEntries.map((entry) => Number.parseInt(entry.number.value, 10) || 0),
            shares: portfolioEntries.map((entry) => Number.parseInt(entry.shares?.value || "0", 10) || 0),
            defaultWeights: defaults.portfolio_weights || [],
            isBacktest: isBacktestView,
            strategy: strategyValue,
            defaultStrategy: defaults.backtest_strategy || "buy-and-hold",
            capital: isBacktestView ? parseTradeCapitalValue(tradeCapitalInput?.value) : "",
            defaultCapital: defaults.backtest_capital ?? 10000,
            interval: isBacktestView ? getSelectedBacktestInterval() : "",
            defaultInterval: defaults.backtest_interval || "1d",
            strategyParams: isBacktestView ? collectStrategyParamEntries() : [],
            strategyParamDefaults,
            stopLossEnabled: isBacktestView ? Boolean(stopLossInput?.checked) : undefined,
            defaultStopLossEnabled: defaults.backtest_stop_loss ?? true,
            showTradeDetailsEnabled: isBacktestView ? Boolean(showTradeDetailsInput?.checked) : undefined,
            defaultShowTradeDetailsEnabled: defaults.backtest_show_trade_details ?? true,
            isDca: isDcaView,
            amount: isDcaView ? parseTradeCapitalValue(tradeCapitalInput?.value) : "",
            defaultAmount: defaults.dca_amount ?? 1000,
            frequency: isDcaView ? getSelectedDcaFrequency() : "",
            defaultFrequency: defaults.dca_frequency || "monthly",
            weekday: document.getElementById("dca_weekday")?.value || "0",
            defaultWeekday: defaults.dca_weekday ?? 0,
            monthDay: document.getElementById("dca_month_day")?.value || "15",
            defaultMonthDay: defaults.dca_month_day ?? 15,
            tab: activeTab,
            page: bootstrap.workspaceTablePage ?? currentUrlState.page,
        }, {
            defaultPeriod: defaults.period || "1y",
        });
    };

    const buildPeriodOptionDefs = (periodValues) => (
        Array.from(periodValues || []).map((value) => ({
            value,
            label: PERIOD_LABELS[value] || value,
        }))
    );

    const replacePeriodOptions = (periodValues, preferredFallback = null) => {
        const periodSelect = document.getElementById("period");
        if (!periodSelect) return;
        const currentPeriod = periodSelect.value;
        const nextOptions = buildPeriodOptionDefs(periodValues);
        if (!nextOptions.length) return;
        periodSelect.innerHTML = "";
        nextOptions.forEach((option) => {
            const el = document.createElement("option");
            el.value = option.value;
            el.textContent = option.label;
            if (option.value === currentPeriod) el.selected = true;
            periodSelect.appendChild(el);
        });
        const allowed = nextOptions.map((option) => option.value);
        periodSelect.value = allowed.includes(currentPeriod)
            ? currentPeriod
            : preferredFallback && allowed.includes(preferredFallback)
                ? preferredFallback
                : allowed[allowed.length - 1];
        refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
    };

    const getRequiredBacktestTickerSnapshot = (requiredTickerCount = getMinimumRequiredTickers()) => (
        getTickerInputs()
            .slice(0, requiredTickerCount)
            .map((input) => sanitizeTicker(input.value.trim()))
            .filter(Boolean)
    );

    const backtestTickerSnapshotsMatch = (left, right) => (
        left.length === right.length
        && left.every((ticker, index) => ticker === right[index])
    );

    const intersectBacktestPeriodOptions = (payload, tickerSnapshot) => {
        const periodOptions = payload?.periodOptions && typeof payload.periodOptions === "object"
            ? payload.periodOptions
            : {};
        const tickerOptions = tickerSnapshot.map((ticker) => periodOptions[ticker] || {});
        const shared = {};
        ["1d", "1m"].forEach((interval) => {
            const firstOptions = Array.isArray(tickerOptions[0]?.[interval])
                ? tickerOptions[0][interval]
                : [];
            shared[interval] = firstOptions.filter((period) => tickerOptions.every((options) => (
                Array.isArray(options?.[interval]) && options[interval].includes(period)
            )));
        });
        return shared;
    };

    const canApplyBacktestIntervalResponse = (requestToken, requiredTickerCount, tickerSnapshot) => (
        requestToken === backtestIntervalRequestToken
        && requiredTickerCount === getMinimumRequiredTickers()
        && backtestTickerSnapshotsMatch(tickerSnapshot, getRequiredBacktestTickerSnapshot())
    );

    const syncBacktestIntervals = async () => {
        if (!isBacktestView) return;
        const requestToken = ++backtestIntervalRequestToken;
        const requiredTickerCount = getMinimumRequiredTickers();
        const tickerSnapshot = getRequiredBacktestTickerSnapshot(requiredTickerCount);
        if (tickerSnapshot.length < requiredTickerCount) {
            const currentInterval = getSelectedBacktestInterval();
            setBacktestIntervalAvailability(false);
            if (currentInterval === "1m") setBacktestIntervalValue("1d");
            return;
        }

        try {
            const params = new URLSearchParams();
            tickerSnapshot.forEach((ticker) => params.append("ticker", ticker));
            const response = await fetch(`${endpoints.marketStorePresence}?${params.toString()}`, {credentials: "same-origin"});
            if (!response.ok) return;
            const payload = await response.json();
            if (!canApplyBacktestIntervalResponse(requestToken, requiredTickerCount, tickerSnapshot)) return;

            const sharedPeriodOptions = intersectBacktestPeriodOptions(payload, tickerSnapshot);
            state.backtestPeriodOptions = {
                ...(state.backtestPeriodOptions || {}),
                ...(sharedPeriodOptions["1d"].length ? {"1d": sharedPeriodOptions["1d"]} : {}),
                "1m": sharedPeriodOptions["1m"],
            };
            const hasAllRequiredTickers = tickerSnapshot.length === requiredTickerCount;
            const has1m = strategyDeclaresBacktestInterval("1m")
                && hasAllRequiredTickers
                && tickerSnapshot.every((ticker) => payload.has1m?.[ticker] === true)
                && sharedPeriodOptions["1m"].length > 0;

            const intervalInputs = getBacktestIntervalInputs();
            if (intervalInputs.length) {
                const currentInterval = getSelectedBacktestInterval();
                setBacktestIntervalAvailability(has1m);
                const nextInterval = currentInterval === "1m" && !has1m ? "1d" : currentInterval;
                setBacktestIntervalValue(nextInterval);

                if (currentInterval === "1m" && !has1m) {
                    replacePeriodOptions(
                        sharedPeriodOptions["1d"].length
                            ? sharedPeriodOptions["1d"]
                            : state.backtestPeriodOptions?.["1d"] || ["1d"],
                        "1d",
                    );
                    const nextInput = getBacktestIntervalInputs().find((input) => input.value === "1d");
                    nextInput?.dispatchEvent(new Event("change", {bubbles: true}));
                } else if (currentInterval !== nextInterval) {
                    const nextInput = getBacktestIntervalInputs().find((input) => input.value === nextInterval);
                    nextInput?.dispatchEvent(new Event("change", {bubbles: true}));
                } else {
                    replacePeriodOptions(
                        sharedPeriodOptions[nextInterval]?.length
                            ? sharedPeriodOptions[nextInterval]
                            : state.backtestPeriodOptions?.[nextInterval] || ["1d"],
                        nextInterval === "1m" ? null : "max",
                    );
                }
            }
        } catch (_error) {
        }
    };

    const syncDateConstraints = async () => {
        if ((!exactStartInput || !exactEndInput) && !exactTradingDateInput) return;
        const requestId = ++dateConstraintsRequestId;
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        if (rangeMode !== "exact") {
            validTradingDateSet = null;
            dateConstraintAvailability = {};
            return;
        }
        const tickers = getFilledTickers();
        if (tickers.length < getMinimumRequiredTickers() || new Set(tickers).size !== tickers.length) return;
        const params = new URLSearchParams({view: state.currentView});
        if (state.currentView === "prices" && getComparisonMetric() === "market-cap") {
            params.set("metric", "market-cap");
        }
        const activeRangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        const activePeriod = periodSelect?.value || defaults.period;
        if (activeRangeMode) params.set("range", activeRangeMode);
        if (activePeriod) params.set("period", activePeriod);
        if (priceOnlyInput?.checked) {
            params.set("price_only", "1");
        } else if (includeDividendsInput?.checked) {
            params.set("dividends", "1");
        }
        if (isOneDayExactDateMode()) {
            if (exactTradingDateInput?.value) {
                params.set("from", exactTradingDateInput.value);
                params.set("to", exactTradingDateInput.value);
            }
        } else {
            if (exactStartInput?.value) params.set("from", exactStartInput.value);
            if (exactEndInput?.value) params.set("to", exactEndInput.value);
        }
        tickers.forEach((ticker) => params.append("ticker", ticker));
        try {
            const response = await fetch(`${endpoints.dateConstraints}?${params.toString()}`);
            if (requestId !== dateConstraintsRequestId) return;
            if (!response.ok) return;
            const payload = await response.json();
            if (requestId !== dateConstraintsRequestId) return;
            validTradingDateSet = payload.trading_dates?.length ? new Set(payload.trading_dates) : null;
            dateConstraintAvailability = payload.availability && typeof payload.availability === "object"
                ? payload.availability
                : {};
            const tradingDateSet = new Set(payload.trading_dates || []);
            if (exactStartInput) {
                exactStartInput.min = payload.min_date || "";
                exactStartInput.max = payload.max_date || "";
            }
            if (exactEndInput) {
                exactEndInput.min = payload.min_date || "";
                exactEndInput.max = payload.max_date || "";
            }
            if (exactTradingDateInput) {
                exactTradingDateInput.min = payload.min_date || "";
                exactTradingDateInput.max = payload.max_date || "";
            }
            if (isOneDayExactDateMode()) {
                const adjustedTradingDate = payload.adjusted_start || payload.adjusted_end || payload.max_date || "";
                const currentTradingDate = exactTradingDateInput?.value || "";
                const shouldUseAdjustedTradingDate = adjustedTradingDate
                    && (!currentTradingDate || (tradingDateSet.size > 0 && !tradingDateSet.has(currentTradingDate)));
                const resolvedTradingDate = shouldUseAdjustedTradingDate ? adjustedTradingDate : currentTradingDate;
                if (resolvedTradingDate && exactTradingDateInput) exactTradingDateInput.value = resolvedTradingDate;
                if (resolvedTradingDate && exactStartInput) exactStartInput.value = resolvedTradingDate;
                if (resolvedTradingDate && exactEndInput) exactEndInput.value = resolvedTradingDate;
            } else {
                if (payload.adjusted_start && exactStartInput) exactStartInput.value = payload.adjusted_start;
                if (payload.adjusted_end && exactEndInput) exactEndInput.value = payload.adjusted_end;
            }
            const enforceTradingDate = (input, fallbackValue) => {
                if (!input.value || tradingDateSet.has(input.value)) return false;
                input.value = fallbackValue || "";
                return true;
            };
            if (isOneDayExactDateMode()) {
                enforceTradingDate(exactTradingDateInput, payload.adjusted_start || payload.adjusted_end || payload.max_date);
            } else {
                enforceTradingDate(exactStartInput, payload.adjusted_start);
                enforceTradingDate(exactEndInput, payload.adjusted_end);
            }
            datePickerState.forEach((picker) => {
                picker.invalidDraft = "";
                picker.validationMessage = "";
            });
            refreshDatePickers();
        } catch (_error) {
        }
    };

    getTickerInputs().forEach((input) => setupAutocomplete(input));
    initializeDatePickers();
    initializeWorkspaceEnhancements();
    initThemeModeControls();
    initGlobalAppearanceControls();
    initGlobalLanguageControls();
    rememberCurrentViewUrl();
    attachDockMemory();
    attachOptimisticInternalNavigation();
    attachRemoveHandlers();
    attachTickerClearHandlers();
    attachPortfolioAllocationHandlers();
    attachPortfolioWeightHandlers();
    reindexTickerFields();
    validateAllTickerInputs();
    syncPortfolioWeightDisabledState();
    ensurePortfolioWeightTouches();
    syncPortfolioWeightBounds();
    dispatchPortfolioPreviewUpdate();
    validatePortfolioWeightInputs();
    updateRangePanels();
    syncBacktestIntervalSegmentedControl();
    syncDcaFrequencySegmentedControl();
    syncAllSegmentedControlLayouts();
    let segmentedLayoutFrame = 0;
    const scheduleSegmentedControlLayoutSync = () => {
        if (segmentedLayoutFrame) window.cancelAnimationFrame(segmentedLayoutFrame);
        segmentedLayoutFrame = window.requestAnimationFrame(() => {
            segmentedLayoutFrame = 0;
            syncAllSegmentedControlLayouts();
        });
    };
    let segmentedFrameResizeObserver = null;
    const observeSegmentedOverflowFrames = () => {
        if (!segmentedFrameResizeObserver) return;
        $$('[data-segmented-overflow-frame]').forEach((frame) => {
            if (!(frame instanceof HTMLElement) || frame.dataset.segmentedResizeObserved === "1") return;
            frame.dataset.segmentedResizeObserved = "1";
            segmentedFrameResizeObserver.observe(frame);
        });
    };
    if (typeof ResizeObserver === "function") {
        segmentedFrameResizeObserver = new ResizeObserver(scheduleSegmentedControlLayoutSync);
        observeSegmentedOverflowFrames();
    }
    if (typeof MutationObserver === "function") {
        const segmentedControlMutationObserver = new MutationObserver(() => {
            observeSegmentedOverflowFrames();
            scheduleSegmentedControlLayoutSync();
        });
        segmentedControlMutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["hidden", "disabled"],
        });
    }
    updateDcaSchedulePanels();
    syncDateConstraints();
    scheduleDockPosition();
    window.addEventListener("resize", () => {
        scheduleSegmentedControlLayoutSync();
    });

    const handleRangeModeChange = (input) => {
        const nextRangeMode = input.value;
        const previousRangeMode = lastRangeMode;
        const hasExactDateSelection = !hasDerivedExactDateRange && (isOneDayExactDateMode()
            ? Boolean(exactTradingDateInput?.value)
            : Boolean(exactStartInput?.value || exactEndInput?.value));
        let shouldAutoSubmit = true;
        if (previousRangeMode !== nextRangeMode) {
            if (nextRangeMode === "exact") {
                const synced = syncExactInputsToRenderedRange();
                hasDerivedExactDateRange = synced;
                if (synced && hasInitialResult) {
                    shouldAutoSubmit = false;
                }
            } else if (nextRangeMode === "period") {
                if (!hasExactDateSelection) {
                    shouldAutoSubmit = false;
                } else {
                    const matchedPeriod = chooseRelativePeriodForExactRange();
                    if (matchedPeriod && periodSelect) {
                        periodSelect.value = matchedPeriod;
                        refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
                    }
                }
            }
        }
        updateRangePanels();
        syncDateConstraints();
        lastRangeMode = nextRangeMode;
        if (!(isBacktestView || isDcaView) && shouldAutoSubmit) requestWorkspaceChartTransition("range-mode");
        if (shouldAutoSubmit) {
            scheduleAutoSubmit();
        }
    };
    rangeModeInputs.forEach((input) => {
        input.addEventListener("change", () => handleRangeModeChange(input));
    });
    comparisonMetricInputs.forEach((input) => {
        input.addEventListener("change", () => {
            if (!input.checked || state.currentView !== "prices") return;
            const nextMetric = normalizeComparisonMetric(input.value);
            const previousMetric = normalizeComparisonMetric(state.comparisonMetric);
            if (nextMetric === previousMetric) return;
            if (isSubmittingWithOverlay) cancelActiveWorkspaceSubmission();

            const restoreMetricSelection = () => {
                comparisonMetricInputs.forEach((candidate) => {
                    candidate.checked = normalizeComparisonMetric(candidate.value) === previousMetric;
                });
                const metricShell = input.closest("[data-comparison-metric-switch]");
                if (metricShell instanceof HTMLElement) {
                    syncSegmentedControlLayout(metricShell, {
                        activeValue: previousMetric,
                        activeIndex: previousMetric === "market-cap" ? 1 : 0,
                    });
                }
            };

            if (nextMetric === "price" && getFilledTickers().length > PRICE_COMPARISON_MAX_TICKERS) {
                restoreMetricSelection();
                showComparisonMetricValidation(
                    translateUi("Price comparisons support up to 5 tickers. Remove an extra ticker before switching."),
                );
                return;
            }
            if (!canAutoSubmit()) {
                restoreMetricSelection();
                validateAllTickerInputs();
                const invalidInput = getTickerInputs().find((candidate) => (
                    !candidate.checkValidity() || candidate.dataset.unknown === "1"
                ));
                if (invalidInput) showTickerValidationTooltip(invalidInput);
                showComparisonMetricValidation(
                    invalidInput
                        ? translateUi("Resolve the highlighted ticker before switching metrics.")
                        : translateUi("Complete the required comparison fields before switching metrics."),
                );
                return;
            }
            clearComparisonMetricValidation();
            state.comparisonMetric = nextMetric;
            if (autoSubmitTimer) {
                window.clearTimeout(autoSubmitTimer);
                autoSubmitTimer = null;
            }

            const metricShell = input.closest("[data-comparison-metric-switch]");
            if (metricShell instanceof HTMLElement) {
                syncSegmentedControlLayout(metricShell, {
                    activeValue: nextMetric,
                    activeIndex: nextMetric === "market-cap" ? 1 : 0,
                });
            }

            const chipsField = document.querySelector("[data-chips-field]");
            const metricChipsInput = chipsField?.querySelector("[data-chips-input]");
            if (chipsField instanceof HTMLElement) {
                const isPriceMetric = nextMetric === "price";
                chipsField.hidden = !isPriceMetric;
                if (metricChipsInput instanceof HTMLInputElement) {
                    metricChipsInput.disabled = !isPriceMetric;
                    if (!isPriceMetric) metricChipsInput.checked = false;
                }
            }

            delete bootstrap.chartWorkspaceRefreshTransition;
            clearWorkspaceChartTransitionRequest();
            requestWorkspaceChartTransition("comparison-metric");
            showImmediateRangeLoadingDialog();

            const nextUrl = buildCleanWorkspaceUrl();
            const currentUrl = `${window.location.pathname}${window.location.search}`;
            if (nextUrl === currentUrl) {
                hideWorkspaceModal();
                return;
            }

            const requiresPriceLimitReload = (
                nextMetric === "price"
                && getFilledTickers().length > PRICE_COMPARISON_MAX_TICKERS
            );
            if (!form || requiresPriceLimitReload) {
                window.requestAnimationFrame(() => window.location.assign(nextUrl));
                return;
            }
            form.requestSubmit();
        });
    });
    [exactStartInput, exactEndInput, exactTradingDateInput].forEach((input) => {
        if (!input) return;
        input.addEventListener("change", () => {
            hasDerivedExactDateRange = false;
            syncDateConstraints();
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("range-controls");
            scheduleAutoSubmit();
        });
    });
    if (includeDividendsInput && form) {
        includeDividendsInput.addEventListener("change", () => {
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("dividends");
            scheduleAutoSubmit(80);
        });
    }
    if (priceOnlyInput && form) {
        syncDividendModeSwitches();
        priceOnlyInput.addEventListener("change", () => {
            syncDividendModeSwitches();
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("price-only");
            scheduleAutoSubmit(80);
        });
    }
    if (stopLossInput && form) {
        stopLossInput.addEventListener("change", () => {
            scheduleAutoSubmit(80);
        });
    }
    if (extendedHoursInput && form) {
        syncOneDayExtendedHoursSwitch();
        extendedHoursInput.addEventListener("change", () => {
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("extended-hours");
            scheduleAutoSubmit(80);
        });
    }
    if (overnightInput && form) {
        syncOneDayOvernightSwitch();
        overnightInput.addEventListener("change", () => {
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("overnight");
            scheduleAutoSubmit(80);
        });
    }
    form?.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.id === "period") {
            // The Period select owns its change handler so custom dropdown events
            // remain reliable even when a sidebar control is repaired in place.
            return;
        }
        if (target instanceof HTMLSelectElement && (target.id === "dca_weekday" || target.id === "dca_month_day")) {
            scheduleAutoSubmit(20);
        }
    });
    getDcaFrequencyInputs().forEach((input) => input.addEventListener("change", (event) => {
        if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
        syncDcaFrequencySegmentedControl();
        updateDcaSchedulePanels();
        scheduleAutoSubmit(20);
    }));
    getBacktestIntervalInputs().forEach((input) => input.addEventListener("change", (event) => {
        if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
        const interval = event.target.value;
        syncBacktestIntervalSegmentedControl();
        const nextPeriods = state.backtestPeriodOptions?.[interval] || (interval === "1m" ? ["1d"] : ["1d"]);
        replacePeriodOptions(nextPeriods, interval === "1m" ? null : "max");
        // Force full reload for interval change to refresh sidebar period options
        scheduleAutoSubmit(20);
    }));

    if ((isBacktestView || isDcaView) && tradeCapitalField && tradeCapitalInput && tradeCapitalSlider) {
        const scheduleTradeInputAutoSubmit = () => {
            scheduleAutoSubmit(720);
        };
        const scheduleTradeSliderAutoSubmit = () => {
            scheduleAutoSubmit(180);
        };
        const openTradeCapitalSlider = () => tradeCapitalField.classList.add("is-open");
        const closeTradeCapitalSlider = () => window.setTimeout(() => {
            if (tradeCapitalField.matches(":focus-within")) return;
            tradeCapitalField.classList.remove("is-open");
            tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
            scheduleTradeSliderAutoSubmit();
        }, 80);
        const syncTradeCapitalControls = (value, formattedValue = null) => {
            const normalized = clampTradeCapital(value);
            tradeCapitalField.dataset.lastValidAmount = String(normalized);
            tradeCapitalInput.value = formattedValue ?? formatTradeCapitalValue(normalized);
            tradeCapitalSlider.value = String(Math.round(normalized));
        };
        const sanitizeTradeCapitalDraft = (value) => String(value || "")
            .replace(/,/g, "")
            .replace(/[^\d.]/g, "");
        const normalizeTradeCapitalDraft = (draftValue) => {
            const sanitized = sanitizeTradeCapitalDraft(draftValue);
            if (!sanitized) return "";
            const [wholePartRaw, ...decimalParts] = sanitized.split(".");
            const wholePart = wholePartRaw.replace(/\D/g, "");
            const decimalPart = decimalParts.join("").replace(/\D/g, "").slice(0, 2);
            if (decimalParts.length) return `${wholePart}.${decimalPart}`;
            return wholePart;
        };
        const deriveTradeCapitalReplacementDraft = (rawValue) => {
            const currentDraft = normalizeTradeCapitalDraft(rawValue);
            const focusDraft = normalizeTradeCapitalDraft(tradeCapitalInput.dataset.focusDraft || "");
            if (!focusDraft || !currentDraft || currentDraft === focusDraft) return currentDraft;
            if (currentDraft.endsWith(focusDraft)) {
                return currentDraft.slice(0, -focusDraft.length) || currentDraft;
            }
            if (currentDraft.startsWith(focusDraft)) {
                return currentDraft.slice(focusDraft.length) || currentDraft;
            }
            return currentDraft;
        };
        const applyTradeCapitalDraft = (draftValue, significantChars) => {
            const nextDraft = normalizeTradeCapitalDraft(draftValue);
            if (!nextDraft) {
                tradeCapitalInput.value = "";
                return false;
            }
            const formattedValue = formatTradeCapitalTypingValue(nextDraft);
            const normalizedValue = parseTradeCapitalValue(formattedValue);
            syncTradeCapitalControls(normalizedValue, formattedValue);
            const nextCaret = resolveTradeCapitalCaretPosition(formattedValue, significantChars);
            tradeCapitalInput.setSelectionRange(nextCaret, nextCaret);
            return true;
        };
        const syncTradeCapitalControlsFromTyping = () => {
            const rawValue = tradeCapitalInput.value;
            if (!String(rawValue || "").replace(/,/g, "").trim()) {
                tradeCapitalInput.value = "";
                return false;
            }
            const significantChars = countTradeCapitalCharsBeforeCaret(rawValue, tradeCapitalInput.selectionStart);
            const formattedValue = formatTradeCapitalTypingValue(rawValue);
            const normalizedValue = parseTradeCapitalValue(formattedValue);
            syncTradeCapitalControls(normalizedValue, formattedValue);
            const nextCaret = resolveTradeCapitalCaretPosition(formattedValue, significantChars);
            tradeCapitalInput.setSelectionRange(nextCaret, nextCaret);
            return true;
        };
        const restoreTradeCapitalControls = () => {
            const fallbackValue = parseTradeCapitalValue(
                tradeCapitalField.dataset.lastValidAmount || tradeCapitalSlider.value || tradeCapitalInput.value
            );
            syncTradeCapitalControls(fallbackValue);
        };
        const selectTradeCapitalInputValue = () => {
            window.requestAnimationFrame(() => {
                const valueLength = tradeCapitalInput.value.length;
                tradeCapitalInput.setSelectionRange(0, valueLength);
            });
        };
        tradeCapitalInput.addEventListener("focus", () => {
            const normalized = parseTradeCapitalValue(tradeCapitalInput.value);
            tradeCapitalField.dataset.lastValidAmount = String(normalized);
            const focusDraft = formatEditableTradeCapitalValue(normalized);
            tradeCapitalInput.dataset.focusDraft = focusDraft;
            tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput = "1";
            tradeCapitalInput.value = focusDraft;
            openTradeCapitalSlider();
            selectTradeCapitalInputValue();
        });
        tradeCapitalInput.addEventListener("click", () => {
            openTradeCapitalSlider();
            selectTradeCapitalInputValue();
        });
        tradeCapitalInput.addEventListener("mouseup", (event) => {
            if (tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput !== "1") return;
            event.preventDefault();
            selectTradeCapitalInputValue();
        });
        tradeCapitalInput.addEventListener("beforeinput", (event) => {
            if (!(event instanceof InputEvent)) return;
            const supportedInputTypes = new Set([
                "insertText",
                "insertFromPaste",
                "deleteContentBackward",
                "deleteContentForward",
            ]);
            if (!supportedInputTypes.has(event.inputType)) return;
            event.preventDefault();
            const currentValue = tradeCapitalInput.value;
            const selectionStart = tradeCapitalInput.selectionStart ?? currentValue.length;
            const selectionEnd = tradeCapitalInput.selectionEnd ?? currentValue.length;
            const isReplacementInsert = tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput === "1"
                && event.inputType.startsWith("insert");
            const currentDraft = isReplacementInsert ? "" : normalizeTradeCapitalDraft(currentValue);
            const startChars = countTradeCapitalCharsBeforeCaret(currentValue, selectionStart);
            const endChars = countTradeCapitalCharsBeforeCaret(currentValue, selectionEnd);
            let nextDraft = currentDraft;
            let nextCaretChars = isReplacementInsert ? 0 : startChars;
            if (event.inputType === "deleteContentBackward") {
                const deleteStart = startChars === endChars ? Math.max(0, startChars - 1) : startChars;
                nextDraft = `${currentDraft.slice(0, deleteStart)}${currentDraft.slice(endChars)}`;
                nextCaretChars = deleteStart;
            } else if (event.inputType === "deleteContentForward") {
                const deleteEnd = startChars === endChars ? endChars + 1 : endChars;
                nextDraft = `${currentDraft.slice(0, startChars)}${currentDraft.slice(deleteEnd)}`;
                nextCaretChars = startChars;
            } else {
                const insertedValue = normalizeTradeCapitalDraft(event.data || "");
                nextDraft = `${currentDraft.slice(0, startChars)}${insertedValue}${currentDraft.slice(endChars)}`;
                nextCaretChars = (isReplacementInsert ? 0 : startChars) + insertedValue.length;
            }
            delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
            tradeCapitalInput.dataset.skipNextTradeCapitalInput = "1";
            if (!applyTradeCapitalDraft(nextDraft, nextCaretChars)) return;
            scheduleTradeInputAutoSubmit();
        });
        tradeCapitalInput.addEventListener("input", () => {
            if (tradeCapitalInput.dataset.skipNextTradeCapitalInput === "1") {
                delete tradeCapitalInput.dataset.skipNextTradeCapitalInput;
                return;
            }
            if (tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput === "1") {
                const replacementDraft = deriveTradeCapitalReplacementDraft(tradeCapitalInput.value);
                delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
                if (!applyTradeCapitalDraft(replacementDraft, replacementDraft.length)) return;
                scheduleTradeInputAutoSubmit();
                return;
            }
            if (!syncTradeCapitalControlsFromTyping()) return;
            scheduleTradeInputAutoSubmit();
        });
        tradeCapitalInput.addEventListener("blur", () => {
            delete tradeCapitalInput.dataset.focusDraft;
            delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
            if (!tradeCapitalInput.value.trim()) restoreTradeCapitalControls();
            else syncTradeCapitalControls(parseTradeCapitalValue(tradeCapitalInput.value));
            scheduleTradeSliderAutoSubmit();
        });
        tradeCapitalSlider.addEventListener("focus", openTradeCapitalSlider);
        tradeCapitalSlider.addEventListener("input", () => {
            const value = clampTradeCapital(Number.parseFloat(tradeCapitalSlider.value) || 0);
            syncTradeCapitalControls(value);
            scheduleTradeSliderAutoSubmit();
        });
        tradeCapitalField.addEventListener("focusout", closeTradeCapitalSlider);
        syncTradeCapitalControls(parseTradeCapitalValue(tradeCapitalInput.value));
    }

    const getTradeStrategyRefs = () => {
        const field = document.querySelector("[data-trade-strategy-field]");
        const select = $("#trade_strategy");
        const trigger = document.querySelector("[data-trade-strategy-trigger]");
        const triggerLabel = document.querySelector("[data-trade-strategy-trigger-label]");
        const dropdown = document.querySelector("[data-trade-strategy-dropdown]");
        const tuneButton = document.querySelector("[data-trade-strategy-tune-button]");
        const panel = document.querySelector("[data-trade-strategy-panel]");
        return {
            field,
            select,
            trigger,
            triggerLabel,
            dropdown,
            tuneButton,
            panel,
        };
    };
    let strategySwitchAnimationTimer = null;
    let strategyFieldsRequestToken = 0;
    let pendingBacktestStrategyNavigation = false;

    const readBacktestStrategyParamMemory = () => {
        try {
            const parsed = JSON.parse(preferenceStorage.local.getItem(BACKTEST_STRATEGY_PARAMS_MEMORY_KEY) || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
            return Object.fromEntries(
                Object.entries(parsed).flatMap(([strategyId, values]) => {
                    if (!strategyId || !values || typeof values !== "object" || Array.isArray(values)) {
                        return [];
                    }
                    const normalizedValues = Object.fromEntries(
                        Object.entries(values).flatMap(([key, value]) => {
                            const normalizedKey = String(key || "").trim();
                            const normalizedValue = String(value ?? "").trim();
                            return normalizedKey && normalizedValue
                                ? [[normalizedKey, normalizedValue]]
                                : [];
                        }),
                    );
                    return Object.keys(normalizedValues).length
                        ? [[strategyId, normalizedValues]]
                        : [];
                }),
            );
        } catch (_error) {
            return {};
        }
    };

    const writeBacktestStrategyParamMemory = (memory) => {
        try {
            preferenceStorage.local.setItem(
                BACKTEST_STRATEGY_PARAMS_MEMORY_KEY,
                JSON.stringify(memory),
            );
        } catch (_error) {
        }
    };

    const restoreBacktestStrategyParams = (
        root,
        strategyId,
        {respectExplicitUrl = true} = {},
    ) => {
        if (!isBacktestView || !(root instanceof HTMLElement)) return false;
        const normalizedStrategyId = String(strategyId || "").trim();
        if (!normalizedStrategyId) return false;
        const remembered = readBacktestStrategyParamMemory()[normalizedStrategyId];
        if (!remembered || typeof remembered !== "object") return false;
        const explicitParams = respectExplicitUrl
            ? new URL(window.location.href).searchParams
            : null;
        let restored = false;
        Object.entries(remembered).forEach(([key, value]) => {
            const field = Array.from(root.querySelectorAll("[data-strategy-param-key]"))
                .find((candidate) => candidate.dataset.strategyParamKey === key);
            const control = field?.querySelector("[data-strategy-param-input][name]");
            if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
                return;
            }
            if (explicitParams?.has(control.name)) return;
            const normalizedValue = String(value || "").trim();
            if (!normalizedValue) return;
            if (control.dataset.strategyParamInput === "select") {
                if (!Array.from(control.options).some((option) => option.value === normalizedValue)) return;
                if (control.value !== normalizedValue) {
                    control.value = normalizedValue;
                    restored = true;
                }
                refreshSharedSelectField(field);
                return;
            }
            if (control.dataset.strategyParamInput === "boolean") {
                const switchInput = field.querySelector("[data-strategy-param-switch]");
                const onValue = control.dataset.switchOnValue || "1";
                const offValue = control.dataset.switchOffValue || "0";
                const nextChecked = normalizedValue === onValue
                    ? true
                    : normalizedValue === offValue
                        ? false
                        : null;
                if (nextChecked === null) return;
                const changed = control.value !== normalizedValue
                    || (switchInput instanceof HTMLInputElement && switchInput.checked !== nextChecked);
                control.value = normalizedValue;
                if (switchInput instanceof HTMLInputElement) switchInput.checked = nextChecked;
                restored = restored || changed;
                return;
            }
            if (control.value !== normalizedValue) {
                control.value = normalizedValue;
                restored = true;
            }
        });
        return restored;
    };

    const rememberBacktestStrategyParams = (strategyId = "") => {
        if (!isBacktestView) return;
        const normalizedStrategyId = String(
            strategyId || document.getElementById("trade_strategy")?.value || state.selectedStrategyId || "",
        ).trim();
        if (!normalizedStrategyId) return;
        const entries = collectStrategyParamEntries();
        if (!entries.length) return;
        const memory = readBacktestStrategyParamMemory();
        memory[normalizedStrategyId] = Object.fromEntries(entries);
        writeBacktestStrategyParamMemory(memory);
    };

    const scheduleStrategyParamSubmit = (delay = 160) => {
        rememberBacktestStrategyParams();
        if (!hasInitialResult) return;
        scheduleAutoSubmit(delay);
    };

    const collectStrategyParamEntries = () => {
        const {field} = getTradeStrategyRefs();
        if (!(field instanceof HTMLElement)) return [];
        const controls = Array.from(field.querySelectorAll("[data-strategy-param-input][name]"));
        return controls.flatMap((control) => {
            if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
                return [];
            }
            const key = control.name?.trim();
            if (!key) return [];
            const value = control.value ?? "";
            return value === "" ? [] : [[key, value]];
        });
    };

    const positionTradeStrategyPanel = () => {
        const {panel} = getTradeStrategyRefs();
        if (!(panel instanceof HTMLElement) || panel.hidden) return;
        panel.classList.remove("is-flipped");
        panel.style.top = "";
        panel.style.bottom = "";
        panel.style.transformOrigin = "";
        panel.style.height = "";
        panel.style.maxHeight = "";
        const panelGrid = panel.querySelector("[data-trade-strategy-params-grid]");
        if (panelGrid instanceof HTMLElement) {
            panelGrid.style.maxHeight = "";
            panelGrid.classList.remove("is-scrollable", "is-scrolling");
        }
    };

    const setTradeStrategyPanelOpen = (isOpen) => {
        const {field, tuneButton, panel} = getTradeStrategyRefs();
        if (!(panel instanceof HTMLElement) || !(tuneButton instanceof HTMLButtonElement)) return;
        const shouldOpen = isOpen && !tuneButton.classList.contains("is-hidden");
        panel.hidden = !shouldOpen;
        tuneButton.classList.toggle("is-active", shouldOpen);
        tuneButton.setAttribute("aria-pressed", shouldOpen ? "true" : "false");
        tuneButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
        if (field instanceof HTMLElement) {
            field.classList.toggle("is-open", shouldOpen);
        }
        if (shouldOpen) {
            positionTradeStrategyPanel();
        } else {
            panel.style.maxHeight = "";
            panel.style.height = "";
            panel.style.top = "";
            panel.style.bottom = "";
            panel.style.transformOrigin = "";
            panel.classList.remove("is-flipped");
            const panelGrid = panel.querySelector("[data-trade-strategy-params-grid]");
            if (panelGrid instanceof HTMLElement) {
                panelGrid.style.maxHeight = "";
                panelGrid.classList.remove("is-scrollable", "is-scrolling");
            }
        }
    };

    const initStrategyParamControls = (root = document) => {
        const panelGrid = root.querySelector?.("[data-trade-strategy-params-grid]");
        if (panelGrid instanceof HTMLElement) {
            panelGrid.classList.remove("is-scrolling");
        }
        const fields = Array.from(root.querySelectorAll("[data-strategy-param-key]"));
        fields.forEach((field) => {
            if (!(field instanceof HTMLElement) || field.dataset.strategyParamBound === "1") return;
            field.dataset.strategyParamBound = "1";

            // Keep editable strategy values local until focus leaves the control.
            const textInput = field.querySelector("[data-strategy-param-input='text']");
            if (textInput instanceof HTMLInputElement) {
                const markTextDraft = () => {
                    textInput.dataset.strategyParamDirty = "1";
                };
                const commitTextDraft = () => {
                    if (textInput.dataset.strategyParamDirty !== "1") return;
                    delete textInput.dataset.strategyParamDirty;
                    scheduleStrategyParamSubmit(80);
                };
                textInput.addEventListener("input", markTextDraft);
                textInput.addEventListener("change", markTextDraft);
                textInput.addEventListener("blur", commitTextDraft);
            }

            const numberInput = field.querySelector("[data-strategy-param-input='number']");
            if (numberInput instanceof HTMLInputElement) {
                const isIntegerField = field.dataset.strategyParamKind === "integer";
                const normalizeStandaloneNumber = (value) => {
                    const parsed = Number.parseFloat(String(value));
                    if (!Number.isFinite(parsed)) return Number.parseFloat(numberInput.min || "0") || 0;
                    const min = Number.parseFloat(numberInput.min || "");
                    const max = Number.parseFloat(numberInput.max || "");
                    let normalized = parsed;
                    if (Number.isFinite(min)) normalized = Math.max(min, normalized);
                    if (Number.isFinite(max)) normalized = Math.min(max, normalized);
                    if (isIntegerField) normalized = Math.round(normalized);
                    return normalized;
                };
                const stepValue = () => {
                    if (isIntegerField) return 1;
                    const parsed = Number.parseFloat(numberInput.step || "0.1");
                    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.1;
                };
                const formatStandaloneNumber = (value) => {
                    if (isIntegerField) {
                        return String(Math.round(value));
                    }
                    const stepText = String(numberInput.step || "");
                    const decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
                    return decimals > 0 ? value.toFixed(decimals) : String(value);
                };
                const syncStandaloneNumber = (value) => {
                    const normalized = normalizeStandaloneNumber(value);
                    numberInput.value = formatStandaloneNumber(normalized);
                    return normalized;
                };
                field.querySelectorAll("[data-strategy-stepper]").forEach((button) => {
                    if (!(button instanceof HTMLButtonElement)) return;
                    button.addEventListener("click", () => {
                        const delta = button.dataset.strategyStepper === "down" ? -stepValue() : stepValue();
                        const currentValue = Number.parseFloat(numberInput.value || "0") || 0;
                        syncStandaloneNumber(currentValue + delta);
                        scheduleStrategyParamSubmit(80);
                    });
                });
                numberInput.addEventListener("focus", () => field.classList.add("is-open"));
                numberInput.addEventListener("click", () => field.classList.add("is-open"));
                numberInput.addEventListener("input", () => {
                    numberInput.dataset.strategyParamDirty = "1";
                });
                numberInput.addEventListener("change", () => {
                    numberInput.dataset.strategyParamDirty = "1";
                });
                numberInput.addEventListener("blur", () => {
                    const hasDraft = numberInput.dataset.strategyParamDirty === "1";
                    syncStandaloneNumber(numberInput.value);
                    delete numberInput.dataset.strategyParamDirty;
                    if (hasDraft) scheduleStrategyParamSubmit(80);
                });
                field.addEventListener("focusout", () => window.setTimeout(() => {
                    if (field.matches(":focus-within")) return;
                    field.classList.remove("is-open");
                    syncStandaloneNumber(numberInput.value);
                }, 80));
                syncStandaloneNumber(numberInput.value);
            }

            const booleanInput = field.querySelector("[data-strategy-param-input='boolean']");
            const booleanSwitch = field.querySelector("[data-strategy-param-switch]");
            if (booleanInput instanceof HTMLInputElement && booleanSwitch instanceof HTMLInputElement) {
                const syncBooleanValue = () => {
                    const onValue = booleanInput.dataset.switchOnValue || "1";
                    const offValue = booleanInput.dataset.switchOffValue || "0";
                    booleanInput.value = booleanSwitch.checked ? onValue : offValue;
                };
                booleanSwitch.addEventListener("change", () => {
                    syncBooleanValue();
                    scheduleStrategyParamSubmit(80);
                });
                syncBooleanValue();
            }

            const selectInput = field.querySelector("[data-strategy-param-input='select']");
            if (selectInput instanceof HTMLSelectElement && !selectInput.closest("[data-shared-select-field]")) {
                selectInput.addEventListener("change", () => scheduleStrategyParamSubmit(80));
            }
        });
    };

    const syncTradeStrategyTuningAvailability = () => {
        const {field, select, tuneButton, panel} = getTradeStrategyRefs();
        if (!(field instanceof HTMLElement)
            || !(select instanceof HTMLSelectElement)
            || !(tuneButton instanceof HTMLButtonElement)
            || !(panel instanceof HTMLElement)) return;
        const hasFields = Boolean(panel.querySelector("[data-strategy-param-key]"));
        field.classList.remove("is-grid-trading-inline");
        panel.classList.remove("grid-trading-parameters-panel");

        tuneButton.classList.toggle("is-hidden", !hasFields);
        tuneButton.disabled = !hasFields;
        tuneButton.setAttribute("aria-hidden", hasFields ? "false" : "true");
        tuneButton.tabIndex = hasFields ? 0 : -1;
        if (!hasFields) {
            setTradeStrategyPanelOpen(false);
        }
    };

    const setTradeStrategyDropdownOpen = (isOpen) => {
        const {field, trigger, dropdown, panel} = getTradeStrategyRefs();
        if (!(dropdown instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) return;
        const sharedParts = getSharedSelectParts(field);
        if (sharedParts) {
            setSharedSelectDropdownOpen(field, isOpen);
            if (field instanceof HTMLElement) {
                field.classList.toggle("is-open", isOpen || (!(panel instanceof HTMLElement) ? false : !panel.hidden));
            }
            return;
        }
        dropdown.hidden = !isOpen;
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (field instanceof HTMLElement) {
            field.classList.toggle("is-open", isOpen || (!(panel instanceof HTMLElement) ? false : !panel.hidden));
        }
        if (isOpen) {
            positionTradeStrategyDropdown();
        } else {
            trigger.removeAttribute("aria-activedescendant");
            resetSidebarDropdownPosition(dropdown);
        }
    };

    const syncTradeStrategyTriggerLabel = () => {
        const {field, select, trigger, triggerLabel} = getTradeStrategyRefs();
        if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement) || !(triggerLabel instanceof HTMLElement)) return;
        if (getSharedSelectParts(field)) {
            syncSharedSelectTriggerLabel(field);
            return;
        }
        const selectedOption = Array.from(select.options).find((option) => option.value === select.value);
        const nextLabel = selectedOption?.textContent?.trim()
            || triggerLabel.dataset.fallbackLabel
            || trigger.getAttribute("title")
            || select.options[0]?.textContent?.trim()
            || "";
        triggerLabel.textContent = nextLabel;
        triggerLabel.dataset.fallbackLabel = nextLabel;
        trigger.title = nextLabel;
        const fieldLabel = field?.querySelector("label")?.textContent?.trim() || "";
        if (fieldLabel) {
            trigger.setAttribute("aria-label", `${fieldLabel}: ${nextLabel}`);
        }
    };

    const positionTradeStrategyDropdown = () => {
        const {field, trigger, dropdown} = getTradeStrategyRefs();
        if (!(dropdown instanceof HTMLElement) || dropdown.hidden || !(trigger instanceof HTMLElement)) return;
        if (getSharedSelectParts(field)) {
            positionSharedSelectDropdown(field);
            return;
        }
        const anchor = field?.querySelector(".trade-strategy-row");
        const anchorRect = anchor instanceof HTMLElement
            ? anchor.getBoundingClientRect()
            : trigger.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height || window.innerHeight || 800;
        const availableHeight = Math.max(
            120,
            viewportHeight - triggerRect.bottom - SIDEBAR_OVERLAY_GAP_PX - 12,
        );
        dropdown.style.position = "fixed";
        dropdown.style.left = `${Math.round(anchorRect.left)}px`;
        dropdown.style.top = `${Math.round(triggerRect.bottom + SIDEBAR_OVERLAY_GAP_PX)}px`;
        dropdown.style.right = "auto";
        dropdown.style.bottom = "auto";
        dropdown.style.width = `${Math.round(anchorRect.width)}px`;
        dropdown.style.minWidth = `${Math.round(triggerRect.width)}px`;
        dropdown.style.maxWidth = "calc(100vw - 24px)";
        dropdown.style.maxHeight = `${Math.round(availableHeight)}px`;
        dropdown.style.zIndex = "10002";
        dropdown.style.overflowY = "auto";
        dropdown.style.overscrollBehavior = "contain";
    };

    const renderTradeStrategyDropdown = () => {
        const {select, dropdown} = getTradeStrategyRefs();
        if (!(select instanceof HTMLSelectElement) || !(dropdown instanceof HTMLElement)) return;
        const currentSelection = String(select.value || "");
        const groups = Array.from(select.querySelectorAll("optgroup"));
        let optionIndex = 0;
        dropdown.innerHTML = "";
        groups.forEach((group) => {
            const groupElement = document.createElement("section");
            groupElement.className = "trade-strategy-dropdown-group";

            const labelElement = document.createElement("p");
            labelElement.className = "trade-strategy-dropdown-label";
            labelElement.textContent = group.label || "";
            groupElement.appendChild(labelElement);

            Array.from(group.querySelectorAll("option")).forEach((option) => {
                const optionButton = document.createElement("button");
                optionButton.type = "button";
                optionButton.className = "trade-strategy-dropdown-option";
                optionButton.id = `${dropdown.id || "trade_strategy_dropdown"}_option_${optionIndex}`;
                optionButton.tabIndex = -1;
                optionIndex += 1;
                optionButton.dataset.value = option.value;
                optionButton.setAttribute("role", "option");
                optionButton.setAttribute("aria-selected", option.value === currentSelection ? "true" : "false");
                if (option.value === currentSelection) {
                    optionButton.classList.add("is-selected", "is-active");
                }

                const checkElement = document.createElement("span");
                checkElement.className = "trade-strategy-dropdown-check";
                checkElement.setAttribute("aria-hidden", "true");

                const textElement = document.createElement("span");
                textElement.className = "trade-strategy-dropdown-text";
                textElement.textContent = option.textContent || option.value;

                optionButton.appendChild(checkElement);
                optionButton.appendChild(textElement);
                optionButton.addEventListener("click", () => {
                    const {select: currentSelect} = getTradeStrategyRefs();
                    if (!(currentSelect instanceof HTMLSelectElement)) return;
                    if (currentSelect.value === option.value) {
                        setTradeStrategyDropdownOpen(false);
                        getTradeStrategyRefs().trigger?.focus({preventScroll: true});
                        return;
                    }
                    currentSelect.value = option.value;
                    syncStrategyOptionSelection(currentSelect, option.value);
                    syncTradeStrategyTriggerLabel();
                    renderTradeStrategyDropdown();
                    setTradeStrategyDropdownOpen(false);
                    getTradeStrategyRefs().trigger?.focus({preventScroll: true});
                    currentSelect.dispatchEvent(new Event("change", {bubbles: true}));
                });
                groupElement.appendChild(optionButton);
            });

            dropdown.appendChild(groupElement);
        });
    };

    const getTradeStrategyOptionButtons = () => {
        const {dropdown} = getTradeStrategyRefs();
        if (!(dropdown instanceof HTMLElement)) return [];
        return Array.from(dropdown.querySelectorAll('[role="option"]'))
            .filter((option) => option instanceof HTMLButtonElement);
    };

    const focusTradeStrategyOption = (targetIndex = null) => {
        const {trigger} = getTradeStrategyRefs();
        const options = getTradeStrategyOptionButtons();
        if (!(trigger instanceof HTMLButtonElement) || !options.length) return;
        const selectedIndex = Math.max(0, options.findIndex((option) => option.getAttribute("aria-selected") === "true"));
        const resolvedIndex = targetIndex === null
            ? selectedIndex
            : Math.max(0, Math.min(options.length - 1, targetIndex));
        options.forEach((option, index) => option.classList.toggle("is-active", index === resolvedIndex));
        const target = options[resolvedIndex];
        trigger.setAttribute("aria-activedescendant", target.id);
        target.focus({preventScroll: true});
        target.scrollIntoView({block: "nearest"});
    };

    const handleTradeStrategyTriggerKeydown = (event) => {
        const {dropdown} = getTradeStrategyRefs();
        if (!(dropdown instanceof HTMLElement)) return;
        if (event.key === "Escape") {
            if (dropdown.hidden) return;
            event.preventDefault();
            setTradeStrategyDropdownOpen(false);
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        closeSharedSelectDropdowns();
        setTradeStrategyPanelOpen(false);
        renderTradeStrategyDropdown();
        setTradeStrategyDropdownOpen(true);
        const options = getTradeStrategyOptionButtons();
        const targetIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
        focusTradeStrategyOption(targetIndex);
    };

    const handleTradeStrategyDropdownKeydown = (event) => {
        const {trigger} = getTradeStrategyRefs();
        const options = getTradeStrategyOptionButtons();
        if (!(trigger instanceof HTMLButtonElement) || !options.length) return;
        const currentIndex = Math.max(0, options.indexOf(document.activeElement));
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const targetIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                    ? options.length - 1
                    : currentIndex + (event.key === "ArrowDown" ? 1 : -1);
            focusTradeStrategyOption(targetIndex);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            setTradeStrategyDropdownOpen(false);
            trigger.focus({preventScroll: true});
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            options[currentIndex]?.click();
            return;
        }
        if (event.key === "Tab") {
            setTradeStrategyDropdownOpen(false);
        }
    };

    const pulseStrategySwitch = () => {
        const {select, panel} = getTradeStrategyRefs();
        if (!(select instanceof HTMLSelectElement)) return;
        select.classList.remove("is-switching");
        if (panel instanceof HTMLElement) {
            panel.classList.remove("is-switching");
        }
        void select.offsetWidth;
        select.classList.add("is-switching");
        if (panel instanceof HTMLElement && !panel.hidden) {
            panel.classList.add("is-switching");
        }
        if (strategySwitchAnimationTimer) window.clearTimeout(strategySwitchAnimationTimer);
        strategySwitchAnimationTimer = window.setTimeout(() => {
            const {select: currentSelect, panel: currentPanel} = getTradeStrategyRefs();
            currentSelect?.classList.remove("is-switching", "is-pressing");
            if (currentPanel instanceof HTMLElement) {
                currentPanel.classList.remove("is-switching");
            }
        }, 380);
    };

    const syncBacktestStrategyTickerContract = (payload = {}) => {
        if (!isBacktestView || !(form instanceof HTMLFormElement)) return;
        const configuredRequired = Number.parseInt(payload.required_tickers, 10);
        if (!Number.isFinite(configuredRequired)) return;
        const requiredTickers = Math.min(MAX_TICKERS, Math.max(1, configuredRequired));
        const defaultTickers = Array.isArray(payload.default_tickers)
            ? payload.default_tickers.map(sanitizeTicker).filter(Boolean).slice(0, requiredTickers)
            : [];
        const previousRequired = Number.parseInt(form.dataset.strategyRequiredTickers || "1", 10) || 1;
        const currentTickers = getFilledTickers();
        const shouldApplyStrategyDefaults = previousRequired === 1
            && currentTickers.length === 0;
        const nextTickers = shouldApplyStrategyDefaults
            ? defaultTickers.slice()
            : currentTickers.slice(0, requiredTickers);
        const usedTickers = new Set(nextTickers);
        for (const defaultTicker of defaultTickers) {
            if (nextTickers.length >= requiredTickers) break;
            if (usedTickers.has(defaultTicker)) continue;
            nextTickers.push(defaultTicker);
            usedTickers.add(defaultTicker);
        }

        form.dataset.strategyRequiredTickers = String(requiredTickers);
        state.strategyRequiredTickers = requiredTickers;
        state.strategyDefaultTickers = defaultTickers;
        state.strategySupports = payload.supports && typeof payload.supports === "object"
            ? payload.supports
            : {};

        while (getTickerFields().length > requiredTickers) {
            getTickerFields()[getTickerFields().length - 1].remove();
        }
        while (getTickerFields().length < requiredTickers) {
            addTickerField("", {focus: false});
        }
        getTickerInputs().forEach((input, index) => {
            const nextTicker = sanitizeTicker(nextTickers[index] || "");
            if (sanitizeTicker(input.value) === nextTicker) return;
            input.value = nextTicker;
            input.dataset.unknown = "";
            input.dataset.validatedTicker = "";
            input.dataset.symbol = "";
            input.dataset.logoUrl = "";
            input.dataset.companyName = "";
            setTickerValidationPending(input, false);
            syncTickerInputDecoration(input);
        });
        reindexTickerFields();
        validateAllTickerInputs();
    };

    const refreshTradeStrategyFields = async (strategyId) => {
        const {panel} = getTradeStrategyRefs();
        if (!(panel instanceof HTMLElement) || !endpoints.strategyFields || !strategyId) return;
        const requestToken = ++strategyFieldsRequestToken;
        try {
            const response = await fetch(`${endpoints.strategyFields}?strategy=${encodeURIComponent(strategyId)}`, {
                credentials: "same-origin",
            });
            if (!response.ok) return;
            const payload = await response.json();
            if (requestToken !== strategyFieldsRequestToken) return;
            panel.innerHTML = payload.html || "";
            restoreBacktestStrategyParams(panel, strategyId, {respectExplicitUrl: false});
            panel.querySelectorAll("[data-shared-select-field]").forEach((field) => initializeSharedSelectField(field));
            syncBacktestStrategyTickerContract(payload);
            initStrategyParamControls(panel);
            syncTradeStrategyTuningAvailability();
            if (!payload.is_tunable) {
                setTradeStrategyPanelOpen(false);
            } else {
                setTradeStrategyPanelOpen(true);
            }
        } catch (_error) {
        }
    };

    const initializeTradeStrategyField = () => {
        const refs = getTradeStrategyRefs();
        if (!(refs.field instanceof HTMLElement)) return;
        if (refs.field.dataset.tradeStrategyBound === "1") return;
        const restored = restoreBacktestStrategyParams(
            refs.field,
            refs.select?.value || state.selectedStrategyId,
        );
        initStrategyParamControls(refs.field);
        syncTradeStrategyTuningAvailability();
        if (refs.tuneButton instanceof HTMLButtonElement && !refs.tuneButton.disabled) {
            setTradeStrategyPanelOpen(true);
        }
        syncTradeStrategyTriggerLabel();
        renderTradeStrategyDropdown();
        if (restored) scheduleStrategyParamSubmit(0);
        refs.field.dataset.tradeStrategyBound = "1";
        if (refs.tuneButton instanceof HTMLButtonElement) {
            refs.tuneButton.addEventListener("click", () => {
                const {panel} = getTradeStrategyRefs();
                setTradeStrategyDropdownOpen(false);
                setTradeStrategyPanelOpen(panel instanceof HTMLElement ? panel.hidden : false);
            });
        }
        if (refs.trigger instanceof HTMLButtonElement) {
            refs.trigger.addEventListener("click", () => {
                const {dropdown} = getTradeStrategyRefs();
                const shouldOpen = dropdown instanceof HTMLElement ? dropdown.hidden : false;
                closeSharedSelectDropdowns();
                setTradeStrategyPanelOpen(false);
                renderTradeStrategyDropdown();
                setTradeStrategyDropdownOpen(shouldOpen);
            });
            refs.trigger.addEventListener("keydown", handleTradeStrategyTriggerKeydown);
        }
        if (refs.dropdown instanceof HTMLElement) {
            refs.dropdown.addEventListener("keydown", handleTradeStrategyDropdownKeydown);
        }
        if (refs.select instanceof HTMLSelectElement) {
            refs.select.addEventListener("change", async () => {
                const {select} = getTradeStrategyRefs();
                if (!(select instanceof HTMLSelectElement)) return;
                rememberBacktestStrategyParams(state.selectedStrategyId);
                syncStrategyOptionSelection(select, select.value);
                syncTradeStrategyTriggerLabel();
                renderTradeStrategyDropdown();
                pulseStrategySwitch();
                await refreshTradeStrategyFields(select.value);
                await syncBacktestIntervals();
                if (!form) return;
                pendingBacktestStrategyNavigation = isBacktestView;
                window.setTimeout(() => form.requestSubmit(), 72);
            });
        }
    };

    const repairSidebarControlBindings = () => {
        upgradeStandaloneSharedSelects();
        getSharedSelectFields()
            .filter((field) => String(field.dataset.sharedSelectKind || "").trim().toLowerCase() !== "strategy")
            .forEach((field) => initializeSharedSelectField(field));
        initializeTradeStrategyField();
        syncBacktestIntervalSegmentedControl();
    };

    window.repairSidebarControlBindings = repairSidebarControlBindings;

    seedTickerValidationState();
    repairSidebarControlBindings();

    window.addEventListener("resize", () => {
        getSharedSelectFields().forEach((field) => positionSharedSelectDropdown(field));
        positionTradeStrategyDropdown();
    });
    document.addEventListener("scroll", (event) => {
        // Scrolling a portalled menu must not remeasure and reposition the menu.
        // Reapplying its unconstrained measurement styles during the scroll event
        // resets scrollTop and makes the option list jump back to its start.
        const scrollTarget = event.target;
        if (scrollTarget instanceof Element && scrollTarget.closest("[data-shared-select-dropdown]")) {
            return;
        }
        getSharedSelectFields().forEach((field) => positionSharedSelectDropdown(field));
        positionTradeStrategyDropdown();
    }, true);
    document.addEventListener("click", (event) => {
        const {field} = getTradeStrategyRefs();
        const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
        const clickedInsideStrategyField = field instanceof HTMLElement
            && (field.contains(event.target) || eventPath.includes(field));
        const strategyDropdown = getSharedSelectParts(field)?.dropdown;
        const clickedInsideStrategyDropdown = strategyDropdown instanceof HTMLElement
            && (strategyDropdown.contains(event.target) || eventPath.includes(strategyDropdown));
        const clickedInsideSharedField = getSharedSelectFields().some((sharedField) => {
            if (sharedField.contains(event.target) || eventPath.includes(sharedField)) return true;
            const dropdown = getSharedSelectParts(sharedField)?.dropdown;
            return dropdown instanceof HTMLElement
                && (dropdown.contains(event.target) || eventPath.includes(dropdown));
        });
        if (!clickedInsideStrategyField && !clickedInsideStrategyDropdown) {
            setTradeStrategyDropdownOpen(false);
        }
        if (!clickedInsideSharedField) {
            closeSharedSelectDropdowns();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        const {trigger, tuneButton, dropdown, panel} = getTradeStrategyRefs();
        const sharedField = getSharedSelectFields().find((field) => {
            if (field.contains(document.activeElement)) return true;
            const dropdown = getSharedSelectParts(field)?.dropdown;
            return dropdown instanceof HTMLElement && dropdown.contains(document.activeElement);
        });
        if (sharedField) {
            setSharedSelectDropdownOpen(sharedField, false);
            getSharedSelectParts(sharedField)?.trigger.focus({preventScroll: true});
        }
        if (dropdown instanceof HTMLElement && !dropdown.hidden) {
            setTradeStrategyDropdownOpen(false);
            trigger?.focus({preventScroll: true});
        }
        if (panel instanceof HTMLElement && !panel.hidden) {
            setTradeStrategyPanelOpen(false);
            tuneButton?.focus({preventScroll: true});
        }
    });
    if (typeof MutationObserver === "function") {
        const sidebarControlObserver = new MutationObserver(() => {
            window.requestAnimationFrame(() => {
                repairSidebarControlBindings();
            });
        });
        sidebarControlObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    if (form) {
        form.noValidate = true;
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (isSubmittingWithOverlay) return;
            const submitToken = ++workspaceSubmitToken;
            const values = getFilledTickers();
            validateAllTickerInputs();
            if (values.length < getMinimumRequiredTickers()) {
                const firstInput = getTickerInputs()[0];
                if (firstInput) showTickerValidationTooltip(firstInput);
                return;
            }
            if (new Set(values).size !== values.length) {
                const invalidInput = getTickerInputs().find((input) => input.validationMessage);
                if (invalidInput) showTickerValidationTooltip(invalidInput);
                return;
            }
            const areTickersValid = await ensureTickerValidityBeforeSubmit();
            if (submitToken !== workspaceSubmitToken) return;
            if (!areTickersValid) {
                const invalidInput = getTickerInputs().find((input) => !input.checkValidity() || input.dataset.unknown === "1");
                if (invalidInput) showTickerValidationTooltip(invalidInput);
                return;
            }
            if (isPortfolioView) {
                const areWeightsValid = validatePortfolioWeightInputs();
                if (!areWeightsValid) {
                    return;
                }
                if (!isPortfolioShareMode()) {
                    const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
                    if (totalWeight !== 100) {
                        return;
                    }
                }
            }
            if (autoSubmitTimer) {
                window.clearTimeout(autoSubmitTimer);
                autoSubmitTimer = null;
            }
            bootstrap.workspaceTablePage = 1;
            const nextUrl = buildCleanWorkspaceUrl();
            const strategySelect = document.getElementById("trade_strategy");
            rememberBacktestStrategyParams(strategySelect?.value);
            const currentUrlObj = new URL(window.location.href);
            const nextUrlObj = new URL(nextUrl, window.location.origin);
            currentUrlObj.searchParams.sort();
            nextUrlObj.searchParams.sort();
            if (hasInitialResult && currentUrlObj.pathname === nextUrlObj.pathname && currentUrlObj.searchParams.toString() === nextUrlObj.searchParams.toString()) {
                return;
            }
            const shouldReloadForStrategyChange = pendingBacktestStrategyNavigation;
            pendingBacktestStrategyNavigation = false;
            if (shouldReloadForStrategyChange) {
                showWorkspaceModal({
                    title: "Preparing strategy",
                    copy: "Loading strategy inputs and calculating the first result. This may take a moment for data-intensive models.",
                    loadingSpinner: true,
                });
                rememberCurrentViewUrl(nextUrl);
                window.requestAnimationFrame(() => window.location.assign(nextUrl));
                return;
            }
            let missingLocalTickers = [];
            try {
                missingLocalTickers = await fetchMissingLocalMarketTickers(values);
            } catch (error) {
                console.warn("Market Store Presence Error:", error);
            }
            if (submitToken !== workspaceSubmitToken) return;
            isSubmittingWithOverlay = true;
            setFormBusyState(true);
            rememberCurrentViewUrl(nextUrl);

            if (strategySelect) {
                const strategyId = strategySelect.value;
                if (strategyId && strategyId !== "buy-and-hold") {
                    let recent = JSON.parse(preferenceStorage.local.getItem(STRATEGY_MEMORY_KEY) || "[]");
                    recent = [strategyId, ...recent.filter((id) => id !== strategyId)].slice(0, 3);
                    preferenceStorage.local.setItem(STRATEGY_MEMORY_KEY, JSON.stringify(recent));
                    refreshStrategyDropdownUI();
                }
            }
            if (missingLocalTickers.length) {
                showWorkspaceModal({
                    title: "Fetching remote market data",
                    copy: `Fetching remote market data for ${missingLocalTickers.join(", ")} and saving it to Local Market Store. Results will appear as soon as loading finishes.`,
                    loadingSpinner: true,
                });
            }
            const currentParams = new URLSearchParams(currentUrlObj.search);
            const nextParams = new URLSearchParams(nextUrlObj.search);
            if (state.currentView === "backtest" && state.selectedStrategyId !== "dca") {
                showWorkspaceModal({
                    title: "Running Backtest",
                    copy: "Calculating strategy signals and performance metrics. This may take a moment depending on the data resolution and strategy complexity.",
                    loadingSpinner: true,
                });
                // Only capture refresh transition if date range (x-axis) hasn't changed:
                // - If ticker/period/interval/exact dates change: full rebuild from scratch (original behavior)
                // - If only strategy parameters / dividends / capital change: animate y-values keeping same x-axis with smooth transition
                function doesRequestChangedXAxis(currentParams, nextParams) {
                    const xAxisKeys = ["ticker", "period", "range", "date", "interval", "from", "exact_start", "to", "exact_end"];
                    for (const key of xAxisKeys) {
                        const current = (currentParams.get(key) || "").toString().trim();
                        const next = (nextParams.get(key) || "").toString().trim();
                        if (current !== next) return true;
                    }
                    return false;
                }

                const xAxisChanged = doesRequestChangedXAxis(currentParams, nextParams);
                if (!xAxisChanged) {
                    captureBacktestRefreshTransition();
                } else {
                    delete bootstrap.backtestRefreshTransition;
                }
            } else if (state.currentView === "dca" || (state.currentView === "backtest" && state.selectedStrategyId === "dca")) {
                showWorkspaceModal({
                    title: "Running DCA simulation",
                    copy: "Calculating recurring buy dates, cumulative shares, and the if-all-in comparison curve for the selected range.",
                    loadingSpinner: true,
                });
                delete bootstrap.chartWorkspaceRefreshTransition;
            } else if (
                state.currentView === "prices"
                && !missingLocalTickers.length
                && didCompareRequestChangeMetric(currentParams, nextParams)
            ) {
                delete bootstrap.chartWorkspaceRefreshTransition;
                showImmediateRangeLoadingDialog();
            } else if (
                ["tickers", "prices"].includes(state.currentView)
                && !missingLocalTickers.length
                && pendingWorkspaceChartTransition?.view === state.currentView
                && String(pendingWorkspaceChartTransition.reason || "").startsWith("ticker")
            ) {
                showWorkspaceModal({
                    title: "Calculating comparison",
                    copy: "Rebuilding the return curve and performance summary for the selected tickers. You can close this dialog while loading continues.",
                    loadingSpinner: true,
                });
            } else if (["tickers", "prices"].includes(state.currentView) && !missingLocalTickers.length && didCompareRequestChangeRange(currentParams, nextParams)) {
                if (state.currentView === "prices") {
                    showImmediateRangeLoadingDialog();
                } else {
                    showWorkspaceModal({
                        title: "Calculating comparison",
                        copy: "Rebuilding the return curve and performance summary for the selected range. You can close this dialog while loading continues.",
                        loadingSpinner: true,
                    });
                }
            } else if (pendingWorkspaceChartTransition?.view === state.currentView) {
                // Same logic: only capture line chart transition if x-axis hasn't changed
                const didRequestChangeXAxis = state.currentView === "portfolio"
                    ? didPortfolioRequestChangeXAxis
                    : bootstrap.didCompareRequestChangeXAxis;
                const xAxisChanged = didRequestChangeXAxis?.(currentParams, nextParams) ?? true;
                if (!xAxisChanged) {
                    captureLineChartRefreshTransition();
                } else {
                    delete bootstrap.chartWorkspaceRefreshTransition;
                }
            } else {
                delete bootstrap.chartWorkspaceRefreshTransition;
            }
            clearWorkspaceChartTransitionRequest();
            applyPendingWorkspaceMarkup();
            try {
                const hydrated = await hydrateWorkspaceFromUrl(nextUrl);
                if (submitToken !== workspaceSubmitToken) return;
                if (hydrated === false) return;
                hasInitialResult = true;
            } catch (error) {
                if (error?.name !== "AbortError") {
                    console.error("Hydration Error: ", error);
                }
                if (error?.name === "AbortError") return;
                window.requestAnimationFrame(() => {
                    window.location.assign(nextUrl);
                });
                return;
            } finally {
                if (submitToken === workspaceSubmitToken) {
                    hideWorkspaceModal();
                    isSubmittingWithOverlay = false;
                    setFormBusyState(false);
                }
            }
        });
    }

    document.addEventListener("submit", (event) => {
        const formElement = event.target.closest(".settings-action-form");
        if (formElement) {
            const actionInput = formElement.querySelector('input[name="action"]');
            const submitButton = formElement.querySelector("button[type='submit']");
            submitButton?.classList.add("is-pending");
            if (actionInput?.value === "refresh") {
                showWorkspaceModal({
                    title: "Saving daily market data to local cache",
                    copy: "We are checking this ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
                    loadingSpinner: true,
                });
            } else if (actionInput?.value === "refresh-1m") {
                showWorkspaceModal({
                    title: "Saving 1-minute market data to local cache",
                    copy: "We are refreshing the latest 6 months of trading days for this ticker and saving the result on this device. Please keep this page open while the download finishes.",
                    loadingSpinner: true,
                });
            }
            return;
        }
        const calloutForm = event.target.closest(".settings-callout-form");
        if (calloutForm) {
            const actionInput = calloutForm.querySelector('input[name="action"]');
            const sectionInput = calloutForm.querySelector('input[name="section"]');
            const submitButton = calloutForm.querySelector("button[type='submit']");
            submitButton?.classList.add("is-pending");
            submitButton?.setAttribute("aria-busy", "true");
            if (actionInput?.value === "maintain") {
                showWorkspaceModal({
                    title: "Maintaining all local market data",
                    copy: "We are checking every cached ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
                    loadingSpinner: true,
                });
            } else if (actionInput?.value === "investment-transactions") {
                showWorkspaceModal({
                    title: "Clearing local broker transaction record",
                    copy: "We are removing the imported local broker transaction history stored on this device. Please keep this page open while this finishes.",
                    loadingSpinner: true,
                });
            } else if (sectionInput?.value === "clear-caches") {
                showWorkspaceModal({
                    title: "Clearing local market data caches",
                    copy: "We are removing non-local market caches while keeping Local Market Store protected entries and ticker usage records. Please keep this page open while this finishes.",
                    loadingSpinner: true,
                });
            }
            return;
        }
        const smtpForm = event.target.closest(".settings-stack-form");
        if (!smtpForm) return;
        const submitter = event.submitter;
        submitter?.classList.add("is-pending");
        submitter?.setAttribute("aria-busy", "true");
    });
    workspaceModalOverlayClose?.addEventListener("click", hideWorkspaceModal);
    window.addEventListener("pageshow", hideWorkspaceModal);
    window.addEventListener("pageshow", () => {
        restoreOptimisticNavigationSnapshot();
        document.body.classList.remove("is-workspace-switching", "is-page-navigating");
        document.documentElement.removeAttribute("data-navigation-target");
        document.documentElement.removeAttribute("aria-busy");
        document.querySelectorAll(".is-masked-during-switch").forEach((node) => {
            node.classList.remove("is-masked-during-switch");
        });
    });
    void bootstrap.hydrateSettingsNetworkStatuses?.();
    void bootstrap.hydrateSettingsLocalStoreRanges?.();

    const syncStrategyOptionSelection = (select, selectedValue) => {
        if (!(select instanceof HTMLSelectElement)) return;
        const normalizedValue = String(selectedValue || "");
        const matchingOptions = Array.from(select.options).filter((option) => option.value === normalizedValue);
        Array.from(select.options).forEach((option) => {
            const isSelected = Boolean(normalizedValue) && option.value === normalizedValue;
            option.defaultSelected = isSelected;
            option.selected = false;
            if (isSelected) {
                option.setAttribute("selected", "selected");
            } else {
                option.removeAttribute("selected");
            }
        });
        if (!matchingOptions.length) return;
        matchingOptions.forEach((option) => {
            option.defaultSelected = true;
            option.setAttribute("selected", "selected");
        });
        const allGroupMatch = matchingOptions.find((option) => option.parentElement?.dataset?.strategyGroup === "all");
        (allGroupMatch || matchingOptions[0]).selected = true;
        select.value = normalizedValue;
    };

    const refreshStrategyDropdownUI = () => {
        const select = document.getElementById("trade_strategy");
        if (!select) return;
        let persistedRecentIds = [];
        try {
            persistedRecentIds = JSON.parse(preferenceStorage.local.getItem(STRATEGY_MEMORY_KEY) || "[]");
        } catch (_e) {
            return;
        }
        const recentGroup = select.querySelector('optgroup[data-strategy-group="recent"]');
        if (!recentGroup) return;

        const currentSelection = select.value;
        const optionById = new Map(
            Array.from(select.options).map((option) => [option.value, option]),
        );
        const serverRecentIds = Array.from(recentGroup.querySelectorAll(":scope > option"))
            .map((option) => option.value);
        const recentIds = [...new Set([...serverRecentIds, ...persistedRecentIds])]
            .map((id) => String(id || "").trim())
            .filter(Boolean)
            .slice(0, 3);
        recentGroup.innerHTML = "";
        recentIds.forEach((id) => {
            if (id === "buy-and-hold") return;
            const reference = optionById.get(id);
            if (reference) {
                const clone = reference.cloneNode(true);
                recentGroup.appendChild(clone);
            }
        });

        recentGroup.hidden = recentGroup.children.length === 0;
        // Restore selection because rebuilding the Recent group can reset it.
        syncStrategyOptionSelection(select, currentSelection);
        syncTradeStrategyTriggerLabel();
        renderTradeStrategyDropdown();
    };

    window.addEventListener("resize", scheduleDockPosition);
    window.addEventListener("orientationchange", scheduleDockPosition);
    window.addEventListener("pageshow", scheduleDockPosition);
    window.addEventListener("resize", scheduleMobilePageBottomPaddingSync);
    window.addEventListener("orientationchange", scheduleMobilePageBottomPaddingSync);
    window.addEventListener("pageshow", scheduleMobilePageBottomPaddingSync);

    if (WORKSPACE_VIEWS.has(state.currentView) && typeof workspaceUrlState?.buildWorkspaceUrl === "function") {
        const canonicalWorkspaceUrl = buildCleanWorkspaceUrl();
        const currentWorkspaceUrl = `${window.location.pathname}${window.location.search}`;
        if (canonicalWorkspaceUrl !== currentWorkspaceUrl) {
            window.history.replaceState(window.history.state, "", canonicalWorkspaceUrl);
            rememberCurrentViewUrl(canonicalWorkspaceUrl);
        }
    }
    initializeWorkspaceEnhancements();
    syncTradeStrategyTriggerLabel();
    renderTradeStrategyDropdown();
    refreshStrategyDropdownUI();
})();
