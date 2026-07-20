/**
 * Shared chart axis helpers used by workspace and trade charts.
 *
 * Code version: v1.0.1
 */
(function bootstrapChartAxisUtils(globalScope) {
    "use strict";

    const WIDE_CHART_BREAKPOINT_PX = 768;
    const WIDE_MAX_TICK_COUNT = 4;
    const NARROW_MAX_TICK_COUNT = 3;

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

    const readThemeToken = (computed, tokenName) => (
        computed.getPropertyValue(tokenName).trim()
    );

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
        buildTickIndexSet,
        sortedTickIndexes,
        readThemeToken,
        readThemeTokens,
        CHART_AXIS_UTILS_VERSION: "v1.0.1",
    });

    globalScope.ANTIGRAVITY_CHART_AXIS = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
