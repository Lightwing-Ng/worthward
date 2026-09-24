/**
 * Shared chart axis helpers used by workspace and trade charts.
 *
 * Code version: v1.10.0
 * - Added: One pixel-space date-axis layout owner keeps edge labels flush,
 *   centers interior labels, maximizes even spacing without collisions, and
 *   can retain optional special dates.
 * - Added: One global Chart.js font owner resolves the computed base family
 *   before any chart is created and refreshes Canvas metrics after fonts load.
 * - Added: One market-session resolver and one New York / market-local
 *   timezone conversion owner shared by charting and SVG export.
 * - Added: Shared rounded y-axis value badges preserve the Investment chart's
 *   decimal anchor, axis-label bounds, and theme radius contract.
 * - Added: Shared stock-price y-axis labels use grouped integers at or above
 *   100 and fixed two-decimal labels below 100.
 * - Added: Shared CSS pixel token parsing for chart dimensions and strokes.
 */
(function bootstrapChartAxisUtils(globalScope) {
    "use strict";

    const WIDE_CHART_BREAKPOINT_PX = 768;
    const WIDE_MAX_TICK_COUNT = 4;
    const NARROW_MAX_TICK_COUNT = 3;
    const STOCK_PRICE_INTEGER_THRESHOLD = 100;
    const STOCK_PRICE_INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    const STOCK_PRICE_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const CONTROLLED_RELATIVE_IMAGE_PATH_PREFIXES = Object.freeze([
        "/market-store/logos/",
        "/api/market-store/logos/",
    ]);
    const SAFE_IMAGE_URL_PROTOCOLS = new Set(["http:", "https:"]);
    const SAFE_IMAGE_URL_BASE = "https://worthward.invalid";

    /**
     * Resolve the computed interface stack so Canvas uses the same Western
     * family as DOM text. Never pass an unresolved CSS variable to Chart.js.
     */
    const resolveChartFontFamily = () => {
        const documentObject = globalScope.document;
        const readComputedStyle = globalScope.getComputedStyle;
        if (!documentObject || typeof readComputedStyle !== "function") return "";
        const root = documentObject.documentElement;
        if (root) {
            const tokenFamily = String(
                readComputedStyle(root).getPropertyValue("--font-family-base") || "",
            ).trim();
            if (tokenFamily) return tokenFamily;
        }
        const body = documentObject.body;
        return body ? String(readComputedStyle(body).fontFamily || "").trim() : "";
    };

    const refreshChartFontMetrics = () => {
        const instances = globalScope.Chart?.instances;
        const charts = instances instanceof Map
            ? Array.from(instances.values())
            : Object.values(instances || {});
        charts.forEach((chart) => {
            if (typeof chart?.update === "function") chart.update("none");
        });
        return charts.length;
    };

    const syncChartFontDefaults = ({refreshExisting = false, forceRefresh = false} = {}) => {
        const chartFont = globalScope.Chart?.defaults?.font;
        if (!chartFont) return "";
        const family = resolveChartFontFamily();
        if (!family) return "";
        const changed = chartFont.family !== family;
        chartFont.family = family;
        if (refreshExisting && (changed || forceRefresh)) refreshChartFontMetrics();
        return family;
    };

    const installChartFontDefaults = () => {
        syncChartFontDefaults();
        const fontsReady = globalScope.document?.fonts?.ready;
        if (fontsReady && typeof fontsReady.then === "function") {
            Promise.resolve(fontsReady).then(() => {
                const refresh = () => syncChartFontDefaults({
                    refreshExisting: true,
                    forceRefresh: true,
                });
                if (typeof globalScope.requestAnimationFrame === "function") {
                    globalScope.requestAnimationFrame(refresh);
                } else {
                    refresh();
                }
            }).catch(() => {});
        }
        if (typeof globalScope.addEventListener === "function") {
            globalScope.addEventListener("worthward:theme-mode-change", () => {
                syncChartFontDefaults({refreshExisting: true});
            });
        }
    };

    installChartFontDefaults();

    /**
     * Choose stable x-axis tick indexes for a series of `count` points.
     * Wide viewports prefer four ticks; narrow viewports prefer three.
     */
    const buildTickIndexSet = (count, plotWidth) => {
        if (count <= 0) return new Set();
        if (count === 1) return new Set([0]);
        const maxTickCount = plotWidth >= WIDE_CHART_BREAKPOINT_PX ? WIDE_MAX_TICK_COUNT : NARROW_MAX_TICK_COUNT;
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

    const sortedTickIndexes = (count, plotWidth) => (
        Array.from(buildTickIndexSet(count, plotWidth)).sort((left, right) => left - right)
    );

    const DATE_AXIS_MIN_GAP_PX = 48;
    const DATE_AXIS_MAX_TICK_COUNT = 12;

    /**
     * Lay out date-axis labels in pixel space.
     *
     * The first label is left-aligned at its point and the last is
     * right-aligned; every interior label is centered. The interior is the
     * largest evenly spaced set (by pixel position) whose measured boxes keep
     * `minGapPx` between neighbors and stay inside `[boundsLeft, boundsRight]`.
     * With `includeSpecialIndexes`, `specialIndexes` are kept first (when they
     * fit) and evenly spaced labels fill the remaining room without colliding.
     * `getKey` deduplicates points that share one label, such as intraday
     * points of the same date; the earliest point of a key is used.
     *
     * Returns `[{index, align, left, right, x}]` sorted by pixel position.
     */
    const layoutDateAxisTicks = ({
        count = 0,
        getPixel,
        measureWidth,
        boundsLeft = -Infinity,
        boundsRight = Infinity,
        minGapPx = DATE_AXIS_MIN_GAP_PX,
        maxTickCount = DATE_AXIS_MAX_TICK_COUNT,
        getKey = (index) => index,
        specialIndexes = [],
        includeSpecialIndexes = false,
    } = {}) => {
        if (!(count > 0) || typeof getPixel !== "function" || typeof measureWidth !== "function") {
            return [];
        }
        const candidates = [];
        const seenKeys = new Set();
        for (let index = 0; index < count; index += 1) {
            const key = getKey(index);
            if (key === null || key === undefined || key === "" || seenKeys.has(key)) continue;
            const x = Number(getPixel(index));
            if (!Number.isFinite(x)) continue;
            seenKeys.add(key);
            candidates.push({index, x});
        }
        if (!candidates.length) return [];
        const widthCache = new Map();
        const widthOf = (index) => {
            if (!widthCache.has(index)) {
                const width = Number(measureWidth(index));
                widthCache.set(index, Number.isFinite(width) && width > 0 ? width : 0);
            }
            return widthCache.get(index);
        };
        const buildBox = (candidate, align) => {
            const width = widthOf(candidate.index);
            const left = align === "left"
                ? candidate.x
                : (align === "right" ? candidate.x - width : candidate.x - (width / 2));
            return {index: candidate.index, x: candidate.x, align, left, right: left + width};
        };
        const first = buildBox(candidates[0], "left");
        if (candidates.length === 1) return [first];
        const last = buildBox(candidates[candidates.length - 1], "right");
        if (first.right + minGapPx > last.left) return [first];
        const fits = (box, placed) => (
            box.left >= boundsLeft
            && box.right <= boundsRight
            && placed.every((other) => (
                box.right + minGapPx <= other.left || other.right + minGapPx <= box.left
            ))
        );
        const interiorCandidates = candidates.slice(1, -1);
        const nearestInterior = (targetX, used) => {
            let best = null;
            interiorCandidates.forEach((candidate) => {
                if (used.has(candidate.index)) return;
                if (!best || Math.abs(candidate.x - targetX) < Math.abs(best.x - targetX)) {
                    best = candidate;
                }
            });
            return best;
        };
        const pinned = [first, last];
        if (includeSpecialIndexes) {
            const specialSet = new Set(
                (Array.isArray(specialIndexes) ? specialIndexes : []).map(Number),
            );
            interiorCandidates
                .filter((candidate) => specialSet.has(candidate.index))
                .forEach((candidate) => {
                    const box = buildBox(candidate, "center");
                    if (fits(box, pinned)) pinned.push(box);
                });
        }
        const span = last.x - first.x;
        const upperSegmentCount = Math.max(1, Math.min(
            Math.max(1, Math.floor(maxTickCount) - 1),
            interiorCandidates.length + 1,
        ));
        let bestLayout = pinned;
        for (let segmentCount = upperSegmentCount; segmentCount >= 1; segmentCount -= 1) {
            const placed = [...pinned];
            const used = new Set(placed.map((box) => box.index));
            let complete = true;
            for (let step = 1; step < segmentCount; step += 1) {
                const candidate = nearestInterior(first.x + ((span * step) / segmentCount), used);
                if (!candidate) {
                    complete = false;
                    break;
                }
                const box = buildBox(candidate, "center");
                used.add(candidate.index);
                if (fits(box, placed)) {
                    placed.push(box);
                } else if (!includeSpecialIndexes || pinned.length === 2) {
                    complete = false;
                    break;
                }
            }
            if (complete) {
                bestLayout = placed;
                break;
            }
        }
        return bestLayout.sort((left, right) => left.x - right.x);
    };

    /**
     * Format stock-price y-axis labels independently from currency minor units.
     * Three-or-more-digit prices use integers; lower prices retain two decimals.
     */
    const formatStockPriceAxisValue = (value, options = {}) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return "";
        const formatter = Math.abs(numericValue) >= STOCK_PRICE_INTEGER_THRESHOLD
            ? STOCK_PRICE_INTEGER_FORMATTER
            : STOCK_PRICE_DECIMAL_FORMATTER;
        const formattedValue = formatter.format(numericValue);
        const resolvedOptions = options && typeof options === "object" ? options : {};
        const currency = String(resolvedOptions.currency || "").trim();
        return resolvedOptions.showCurrency && currency
            ? `${currency} ${formattedValue}`
            : formattedValue;
    };

    /**
     * Build the standard buy-and-hold comparison series used by Backtest.
     * The first available opening price determines whole-share allocation;
     * every point is then marked to the closing price with residual cash.
     */
    const buildAllInEquitySeries = (openSeries, closeSeries, capital) => {
        const initialCapital = Number(capital || 0);
        if (!Array.isArray(closeSeries) || !closeSeries.length || !Number.isFinite(initialCapital)) return [];
        const hasOpeningSeries = Array.isArray(openSeries) && openSeries.length > 0;
        const openingPrice = Number((hasOpeningSeries ? openSeries[0] : closeSeries[0]) || 0);
        if (!(openingPrice > 0)) return closeSeries.map(() => initialCapital);
        const shares = Math.floor(initialCapital / openingPrice);
        const cash = initialCapital - (shares * openingPrice);
        return closeSeries.map((value) => Number((cash + (shares * Number(value || 0))).toFixed(4)));
    };

    const readThemeToken = (computed, tokenName) => (
        computed.getPropertyValue(tokenName).trim()
    );

    const readPxToken = (element, tokenName, fallbackValue) => {
        if (!(element instanceof Element)) return fallbackValue;
        const rawValue = getComputedStyle(element).getPropertyValue(tokenName).trim();
        const parsed = Number.parseFloat(rawValue);
        return Number.isFinite(parsed) ? parsed : fallbackValue;
    };

    /**
     * Draw a filled value badge over a chart's y-axis labels. Decimal values
     * share the rendered tick column so hover values do not visually shift.
     */
    const drawYAxisValueBadge = (chartInstance, {
        y,
        value,
        formattedValue,
        formatTickLabel = (tickValue) => String(tickValue ?? ""),
        fillColor = "#0055cc",
        boundsProperty = "",
        boundsAliases = {},
    } = {}) => {
        const {ctx, chartArea, scales} = chartInstance || {};
        const yScale = scales?.y;
        const numericY = Number(y);
        const numericValue = Number(value);
        const valueCopy = String(formattedValue ?? "").trim();
        if (
            !ctx
            || !chartArea
            || !yScale
            || !Number.isFinite(numericY)
            || numericY < chartArea.top
            || numericY > chartArea.bottom
            || !Number.isFinite(numericValue)
            || !valueCopy
        ) {
            return null;
        }

        const decimalIndex = valueCopy.lastIndexOf(".");
        const integerCopy = decimalIndex >= 0 ? valueCopy.slice(0, decimalIndex) : valueCopy;
        const fractionCopy = decimalIndex >= 0 ? valueCopy.slice(decimalIndex) : "";

        ctx.save();
        const visibleAxisLabelItems = (Array.isArray(yScale._labelItems) ? yScale._labelItems : [])
            .filter((item) => String(item?.label ?? "").trim());
        const visibleAxisLabelItem = visibleAxisLabelItems
            .find((item) => String(item?.label ?? "").includes("."))
            || visibleAxisLabelItems[0];
        const axisLabelOptions = visibleAxisLabelItem?.options || {};
        const axisTickCopy = String(visibleAxisLabelItem?.label ?? "");
        ctx.font = String(
            visibleAxisLabelItem?.font?.string
            || `400 12px ${getComputedStyle(document.body).fontFamily}`
        );
        ctx.textBaseline = "middle";
        const axisLabelTranslationX = Number(axisLabelOptions?.translation?.[0]);
        const axisTickWidth = ctx.measureText(axisTickCopy).width;
        const axisTextAlign = String(axisLabelOptions?.textAlign || "right");
        const axisLabelRight = Number.isFinite(axisLabelTranslationX)
            ? axisLabelTranslationX + (
                axisTextAlign === "center"
                    ? axisTickWidth / 2
                    : (axisTextAlign === "left" || axisTextAlign === "start" ? axisTickWidth : 0)
            )
            : Number(yScale.right ?? chartArea.left);
        const axisTickDecimalIndex = axisTickCopy.lastIndexOf(".");
        const axisFractionCopy = axisTickDecimalIndex >= 0
            ? axisTickCopy.slice(axisTickDecimalIndex)
            : "";
        const axisFractionWidth = axisFractionCopy
            ? ctx.measureText(axisFractionCopy).width
            : 0;
        const decimalAnchor = axisLabelRight - axisFractionWidth;
        const integerWidth = ctx.measureText(integerCopy).width;
        const fractionWidth = ctx.measureText(fractionCopy).width;
        const widestAxisTickWidth = (Array.isArray(yScale.ticks) ? yScale.ticks : []).reduce(
            (width, tick) => Math.max(
                width,
                ctx.measureText(formatTickLabel(tick?.value, yScale.ticks)).width,
            ),
            0,
        );
        const horizontalPadding = 5;
        const badgeLeft = Math.min(
            decimalAnchor - integerWidth - horizontalPadding,
            axisLabelRight - widestAxisTickWidth - horizontalPadding,
        );
        const badgeRight = decimalAnchor + fractionWidth + horizontalPadding;
        const badgeHeight = 20;
        const allocationBadgeRadius = Number.parseFloat(
            typeof getComputedStyle === "function"
                ? getComputedStyle(chartInstance.canvas)
                    .getPropertyValue("--investment-holdings-allocation-badge-radius")
                : "",
        );
        const badgeRadius = Math.min(
            Number.isFinite(allocationBadgeRadius) ? allocationBadgeRadius : 0,
            (badgeRight - badgeLeft) / 2,
            badgeHeight / 2,
        );
        const badgeTop = numericY - (badgeHeight / 2);
        const badgeWidth = badgeRight - badgeLeft;
        const bounds = {
            badgeBottom: numericY + (badgeHeight / 2),
            badgeLeft,
            badgeRight,
            badgeTop,
            axisLabelRight,
            axisTickCopy,
            decimalAnchor,
            formattedValue: valueCopy,
            value: numericValue,
            y: numericY,
            ...(boundsAliases && typeof boundsAliases === "object" ? boundsAliases : {}),
        };
        if (boundsProperty) {
            chartInstance[boundsProperty] = {
                ...(chartInstance[boundsProperty] || {}),
                ...bounds,
            };
        }

        ctx.fillStyle = fillColor;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
            ctx.roundRect(badgeLeft, badgeTop, badgeWidth, badgeHeight, badgeRadius);
        } else {
            ctx.moveTo(badgeLeft + badgeRadius, badgeTop);
            ctx.arcTo(badgeRight, badgeTop, badgeRight, badgeTop + badgeHeight, badgeRadius);
            ctx.arcTo(badgeRight, badgeTop + badgeHeight, badgeLeft, badgeTop + badgeHeight, badgeRadius);
            ctx.arcTo(badgeLeft, badgeTop + badgeHeight, badgeLeft, badgeTop, badgeRadius);
            ctx.arcTo(badgeLeft, badgeTop, badgeRight, badgeTop, badgeRadius);
            ctx.closePath();
        }
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "right";
        ctx.fillText(integerCopy, decimalAnchor, numericY);
        if (fractionCopy) {
            ctx.textAlign = "left";
            ctx.fillText(fractionCopy, decimalAnchor, numericY);
        }
        ctx.restore();
        return bounds;
    };

    /**
     * Normalize image sources accepted by dynamic chart markup.
     * Root-relative sources are limited to the application's logo routes.
     */
    const normalizeSafeImageUrl = (value) => {
        const rawValue = String(value ?? "").trim();
        if (!rawValue) return "";

        if (rawValue.startsWith("/") && !rawValue.startsWith("//")) {
            try {
                const parsed = new URL(rawValue, SAFE_IMAGE_URL_BASE);
                if (!CONTROLLED_RELATIVE_IMAGE_PATH_PREFIXES.some(
                    (prefix) => parsed.pathname.startsWith(prefix),
                )) {
                    return "";
                }
                return `${parsed.pathname}${parsed.search}${parsed.hash}`;
            } catch (_error) {
                return "";
            }
        }

        try {
            const parsed = new URL(rawValue);
            if (!SAFE_IMAGE_URL_PROTOCOLS.has(parsed.protocol)) return "";
            return parsed.href;
        } catch (_error) {
            return "";
        }
    };

    /**
     * Read theme color tokens from the document body.
     * Optional fallbacks cover pages that still mirror WORTHWARD_APP.theme.
     */
    const readThemeTokens = (fallbacks = {}) => {
        const computed = getComputedStyle(document.body);
        const theme = globalScope.WORTHWARD_APP?.theme || {};
        return {
            text: readThemeToken(computed, "--theme-text") || fallbacks.text || theme.text || "",
            muted: readThemeToken(computed, "--theme-muted") || fallbacks.muted || theme.muted || "",
            accentPrimary: readThemeToken(computed, "--theme-accent-primary")
                || fallbacks.accentPrimary
                || theme.accent_primary
                || "",
            accentSecondary: readThemeToken(computed, "--theme-accent-secondary")
                || fallbacks.accentSecondary
                || theme.accent_secondary
                || "",
            accentPositive: readThemeToken(computed, "--theme-accent-positive")
                || fallbacks.accentPositive
                || theme.accent_positive
                || "",
        };
    };

    // Shared by Investment Overview and Stock details; styling stays in the
    // existing trade-chart-hover-date-label component.
    const updateHoverDateLabel = (element, {lines, x, top, width, offsetX = 0} = {}) => {
        if (!element) return;
        if (!lines || !Number.isFinite(x) || !Number.isFinite(top)) {
            element.hidden = true;
            element.classList.remove("is-visible");
            return;
        }
        const spans = element.querySelectorAll("span");
        for (let index = 0; index < 2; index += 1) {
            const line = spans[index];
            if (!line) continue;
            const text = lines[index] || "";
            if (line.textContent !== text) line.textContent = text;
            if (index === 1) line.hidden = !text;
        }
        element.hidden = false;
        const halfWidth = (element.offsetWidth || 42) / 2;
        const clampedX = width > 0
            ? Math.max(halfWidth, Math.min(width - halfWidth, x))
            : x;
        for (const [property, value] of [["left", `${clampedX + offsetX}px`], ["top", `${top}px`]]) {
            if (element.style.getPropertyValue(property) !== value) {
                element.style.setProperty(property, value);
            }
        }
        element.classList.add("is-visible");
    };


    /**
     * Resolve the serialized market-session projection published by the
     * server. `app/core/market_sessions.py` is the sole maintained owner of
     * ticker suffixes, IANA timezones, and regular-session minutes; the
     * browser never keeps a second rule table.
     */
    const readMarketSessionConfigs = () => {
        const published = globalScope.WORTHWARD_MARKET_SESSIONS;
        return Array.isArray(published) ? published : [];
    };

    const DEFAULT_MARKET_TIME_CONFIG = Object.freeze({
        market: "US",
        timezone: "America/New_York",
        label: "NYT",
        openMinute: (9 * 60) + 30,
        closeMinute: 16 * 60,
        lastBarMinute: (16 * 60) - 1,
        barEndMinute: 16 * 60,
        segments: [],
    });

    /**
     * Return the market-time configuration for a ticker suffix.
     * Entries are consumed in the canonical backend order, so suffix
     * precedence matches `infer_ticker_market()` exactly.
     */
    const resolveMarketTimeConfig = (ticker) => {
        const normalized = String(ticker || "").toUpperCase();
        const configs = readMarketSessionConfigs();
        const match = configs.find((config) => (
            Array.isArray(config?.suffixes)
            && config.suffixes.some((suffix) => normalized.endsWith(String(suffix)))
        ));
        if (match) return match;
        const fallback = configs.find((config) => (
            Array.isArray(config?.suffixes) && config.suffixes.length === 0
        ));
        return fallback || DEFAULT_MARKET_TIME_CONFIG;
    };

    /**
     * Return the signed offset, in minutes, between a timezone's wall clock
     * and UTC at one instant. Daylight-saving transitions are resolved by the
     * platform's own zone data rather than a stored offset table.
     */
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

    /**
     * Convert a New York wall-clock instant, expressed in milliseconds of the
     * project's serial timeline, into the requested timezone's wall-clock
     * parts. The application's timestamp contract keeps every stored series in
     * New York wall time, so the market-local view is always derived, never
     * stored.
     */
    const newYorkWallMsToMarketParts = (newYorkWallMs, timezone) => {
        if (!Number.isFinite(newYorkWallMs) || !timezone) return null;
        const newYorkOffset = getTimezoneOffsetMinutes("America/New_York", newYorkWallMs);
        const actualUtcMs = newYorkWallMs - (newYorkOffset * 60000);
        const marketOffset = getTimezoneOffsetMinutes(timezone, actualUtcMs);
        const localDate = new Date(actualUtcMs + (marketOffset * 60000));
        return {
            year: localDate.getUTCFullYear(),
            monthIndex: localDate.getUTCMonth(),
            day: localDate.getUTCDate(),
            hours: localDate.getUTCHours(),
            minutes: localDate.getUTCMinutes(),
            offsetMinutes: marketOffset,
        };
    };

    /**
     * Convert a market-local date and minute-of-day into the New York serial
     * minute used by the shared one-day charting window.
     */
    const marketMinuteToNewYorkSerialMinute = (dateText, marketMinute, timezone) => {
        if (!dateText || !timezone || !Number.isFinite(marketMinute)) return null;
        const match = String(dateText).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (![year, month, day].every(Number.isFinite)) return null;
        const localWallUtcMs = Date.UTC(year, month - 1, day, Math.floor(marketMinute / 60), marketMinute % 60);
        const marketOffset = getTimezoneOffsetMinutes(timezone, localWallUtcMs);
        const actualUtcMs = localWallUtcMs - (marketOffset * 60000);
        const newYorkOffset = getTimezoneOffsetMinutes("America/New_York", actualUtcMs);
        return Math.round((actualUtcMs + (newYorkOffset * 60000)) / 60000);
    };

    const api = Object.freeze({
        WIDE_CHART_BREAKPOINT_PX,
        STOCK_PRICE_INTEGER_THRESHOLD,
        updateHoverDateLabel,
        buildTickIndexSet,
        sortedTickIndexes,
        layoutDateAxisTicks,
        formatStockPriceAxisValue,
        buildAllInEquitySeries,
        drawYAxisValueBadge,
        readPxToken,
        readThemeToken,
        readThemeTokens,
        normalizeSafeImageUrl,
        resolveMarketTimeConfig,
        getTimezoneOffsetMinutes,
        newYorkWallMsToMarketParts,
        marketMinuteToNewYorkSerialMinute,
        resolveChartFontFamily,
        refreshChartFontMetrics,
        syncChartFontDefaults,
        installChartFontDefaults,
        DEFAULT_MARKET_TIME_CONFIG,
        CHART_AXIS_UTILS_VERSION: "v1.10.0",
    });

    globalScope.WORTHWARD_CHART_AXIS = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
