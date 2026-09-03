/**
 * Shared chart axis helpers used by workspace and trade charts.
 *
 * Code version: v1.4.0
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
            || "400 12px \"GDS Transport\", \"Helvetica Neue\", Arial, sans-serif"
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

    const api = Object.freeze({
        WIDE_CHART_BREAKPOINT_PX,
        STOCK_PRICE_INTEGER_THRESHOLD,
        buildTickIndexSet,
        sortedTickIndexes,
        formatStockPriceAxisValue,
        buildAllInEquitySeries,
        drawYAxisValueBadge,
        readPxToken,
        readThemeToken,
        readThemeTokens,
        normalizeSafeImageUrl,
        CHART_AXIS_UTILS_VERSION: "v1.4.0",
    });

    globalScope.WORTHWARD_CHART_AXIS = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
