/* Code version: v1.0.0 */
(() => {
    const root = document.documentElement;
    const fallbackValues = Object.freeze({
        layoutSwitchMin: 768,
        sidebarOverlayMax: 600,
        settingsDensityMax: 980,
        investmentFormDensityMax: 1080,
        tradeLayoutMin: 1024,
        tradeMetricsWideMin: 1200,
        paginationCompactMax: 320,
        paginationTinyMax: 280,
        investmentDateGridMax: 560,
        portfolioDonutMax: 430,
        sidebarToggleTightMax: 500,
        livePinTightMax: 420,
    });

    const readCssPixel = (tokenName, fallback) => {
        const rawValue = window.getComputedStyle(root).getPropertyValue(tokenName).trim();
        const value = Number.parseFloat(rawValue);
        return Number.isFinite(value) ? value : fallback;
    };

    const layoutSwitchMin = readCssPixel(
        "--responsive-breakpoint-layout-switch-min",
        fallbackValues.layoutSwitchMin,
    );
    const breakpoints = Object.freeze({
        layoutSwitchMin,
        contentStackMax: layoutSwitchMin - 1,
        sidebarOverlayMax: readCssPixel(
            "--responsive-breakpoint-sidebar-overlay-max",
            fallbackValues.sidebarOverlayMax,
        ),
        settingsDensityMax: readCssPixel(
            "--responsive-breakpoint-settings-density-max",
            fallbackValues.settingsDensityMax,
        ),
        investmentFormDensityMax: readCssPixel(
            "--responsive-breakpoint-investment-form-density-max",
            fallbackValues.investmentFormDensityMax,
        ),
        tradeLayoutMin: readCssPixel(
            "--responsive-breakpoint-trade-layout-min",
            fallbackValues.tradeLayoutMin,
        ),
        tradeMetricsWideMin: readCssPixel(
            "--responsive-breakpoint-trade-metrics-wide-min",
            fallbackValues.tradeMetricsWideMin,
        ),
        paginationCompactMax: readCssPixel(
            "--responsive-breakpoint-pagination-compact-max",
            fallbackValues.paginationCompactMax,
        ),
        paginationTinyMax: readCssPixel(
            "--responsive-breakpoint-pagination-tiny-max",
            fallbackValues.paginationTinyMax,
        ),
        investmentDateGridMax: readCssPixel(
            "--responsive-breakpoint-investment-date-grid-max",
            fallbackValues.investmentDateGridMax,
        ),
        portfolioDonutMax: readCssPixel(
            "--responsive-breakpoint-portfolio-donut-max",
            fallbackValues.portfolioDonutMax,
        ),
        sidebarToggleTightMax: readCssPixel(
            "--responsive-breakpoint-sidebar-toggle-tight-max",
            fallbackValues.sidebarToggleTightMax,
        ),
        livePinTightMax: readCssPixel(
            "--responsive-breakpoint-live-pin-tight-max",
            fallbackValues.livePinTightMax,
        ),
    });

    const media = (name, direction = name.endsWith("Min") ? "min" : "max") => {
        const value = breakpoints[name];
        if (!Number.isFinite(value)) {
            throw new Error(`Unknown responsive breakpoint: ${name}`);
        }
        return window.matchMedia(`(${direction}-width: ${value}px)`);
    };

    window.ANTIGRAVITY_RESPONSIVE = Object.freeze({
        breakpoints,
        media,
    });
})();
