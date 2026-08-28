/**
 * Shared chart axis helpers used by workspace and trade charts.
 *
 * Code version: v1.2.0
 * - Added: Shared stock-price y-axis labels use grouped integers at or above
 *   100 and fixed two-decimal labels below 100.
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
    const SAFE_IMAGE_URL_BASE = "https://antigravity.invalid";

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
     * Optional fallbacks cover pages that still mirror ANTIGRAVITY_APP.theme.
     */
    const readThemeTokens = (fallbacks = {}) => {
        const computed = getComputedStyle(document.body);
        const theme = globalScope.ANTIGRAVITY_APP?.theme || {};
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
        readThemeToken,
        readThemeTokens,
        normalizeSafeImageUrl,
        CHART_AXIS_UTILS_VERSION: "v1.2.0",
    });

    globalScope.ANTIGRAVITY_CHART_AXIS = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
