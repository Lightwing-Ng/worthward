/* Code version: v1.4.1 */
/** Shared square-cell layout with equal historical and forecast time spans. */
(function bootstrapPriceFieldDetailChart(scope) {
    "use strict";
    const computeDirectForecastPriceDomain = ({
        anchorPrice,
        history = [],
        horizonMean = [],
        horizonStd = [],
        standardDeviationRadius = 2.576,
        paddingRatio = 0.06,
        minimumHalfSpanRatio = 0.005,
    } = {}) => {
        const anchor = Number(anchorPrice);
        const radius = Number(standardDeviationRadius);
        const padding = Number(paddingRatio);
        const minimumRatio = Number(minimumHalfSpanRatio);
        if (!(anchor > 0) || !(radius > 0) || !(padding >= 0) || !(minimumRatio > 0)
            || !Array.isArray(horizonMean) || !Array.isArray(horizonStd)
            || horizonMean.length === 0 || horizonMean.length !== horizonStd.length) return null;
        const historyReturns = [];
        history.forEach((value) => {
            const price = Number(value);
            if (Number.isFinite(price) && price > 0) {
                historyReturns.push(Math.log(price / anchor));
            }
        });
        const forecastReturns = [];
        for (let index = 0; index < horizonMean.length; index += 1) {
            const mean = Number(horizonMean[index]);
            const standardDeviation = Number(horizonStd[index]);
            if (!Number.isFinite(mean) || !(standardDeviation > 0)) return null;
            const lowerReturn = Math.max(-20, Math.min(20, mean - (radius * standardDeviation)));
            const upperReturn = Math.max(-20, Math.min(20, mean + (radius * standardDeviation)));
            forecastReturns.push(lowerReturn, upperReturn);
        }
        const forecastHalfSpan = Math.max(
            ...forecastReturns.map((value) => Math.abs(value)),
        );
        const historyHalfSpan = Math.max(
            0,
            ...historyReturns.map((value) => Math.abs(value)),
        );
        // Gaussian direct heads live in log-return space. Keep the anchor at the
        // geometric midpoint so an upper lognormal tail cannot manufacture an
        // equally large, mostly empty linear-price region below the anchor.
        const halfSpan = Math.max(
            Math.log1p(minimumRatio),
            forecastHalfSpan,
            Math.min(historyHalfSpan, forecastHalfSpan * 1.5),
        ) * (1 + padding);
        if (!(halfSpan > 0) || !Number.isFinite(halfSpan)) return null;
        const lowerPrice = anchor * Math.exp(-halfSpan);
        const upperPrice = anchor * Math.exp(halfSpan);
        if (!(lowerPrice > 0) || !Number.isFinite(upperPrice)) return null;
        return Object.freeze({
            lowerPrice,
            upperPrice,
            lowerLogReturn: -halfSpan,
            upperLogReturn: halfSpan,
            scaleKind: "symmetric-log-return",
            standardDeviationRadius: radius,
        });
    };
    const computeLayout = ({width, height, anchorPrice, lowerPrice, upperPrice,
        rowsAbove, rowsBelow, columns, history = [], horizon = history.length - 1,
        gap = 2, padding = 2, priceScale = "linear"}) => {
        const rowCount = rowsAbove + rowsBelow;
        const anchor = Number(anchorPrice);
        const lower = Number(lowerPrice);
        const upper = Number(upperPrice);
        const usesLogPriceScale = priceScale === "log";
        if (!["linear", "log"].includes(priceScale)
            || ![width, height, anchor, lower, upper, columns, horizon].every(Number.isFinite)
            || !(width > 0 && height > 0 && upper > lower && columns > 0 && horizon > 0)) return null;
        let valueStep = (upper - lower) / rowCount;
        if (usesLogPriceScale) {
            if (!(anchor > 0) || !(lower > 0)) return null;
            const lowerReturn = Math.log(lower / anchor);
            const upperReturn = Math.log(upper / anchor);
            const symmetryTolerance = 1e-9 * Math.max(1, Math.abs(lowerReturn), Math.abs(upperReturn));
            if (Math.abs(lowerReturn + upperReturn) > symmetryTolerance) return null;
            valueStep = (upperReturn - lowerReturn) / rowCount;
        }
        if (!(valueStep > 0) || !Number.isFinite(valueStep)) return null;
        const anchorX = width / 2;
        const anchorY = height / 2;
        const pitch = Math.min((anchorX - padding) / columns,
            (anchorY - padding) / Math.max(rowsAbove, rowsBelow));
        if (!(pitch > 0)) return null;
        const cellGap = Math.min(gap, pitch / 2);
        const cellSize = pitch - cellGap;
        const scale = pitch / valueStep;
        const priceToY = usesLogPriceScale
            ? (price) => anchorY - Math.log(Number(price) / anchor) * scale
            : (price) => anchorY - (Number(price) - anchor) * scale;
        const yToPrice = usesLogPriceScale
            ? (y) => anchor * Math.exp((anchorY - Number(y)) / scale)
            : (y) => anchor + (anchorY - Number(y)) / scale;
        // Missing early history leaves empty time; it must not stretch the observed suffix.
        const historyX = (index) => anchorX - (history.length - 1 - index) * columns * pitch / horizon;
        return Object.freeze({anchorX, anchorY, cellWidth: cellSize, cellHeight: cellSize,
            columnGap: cellGap, rowGap: cellGap, pitch,
            gridLeft: anchorX + cellGap / 2,
            gridTop: anchorY - rowsAbove * pitch + cellGap / 2,
            gridWidth: columns * pitch - cellGap,
            gridHeight: rowCount * pitch - cellGap,
            historyLeft: anchorX - columns * pitch,
            forecastRight: anchorX + columns * pitch,
            minPrice: yToPrice(height),
            maxPrice: yToPrice(0),
            priceScale, priceToY, yToPrice, historyX});
    };
    const buildObservedPaths = (prices, layout, anchorPrice, horizon, columns) => {
        const paths = {up: [], down: []};
        const valid = (value) => typeof value === "number" && Number.isFinite(value);
        const point = (index) => ({x: layout.anchorX + index * columns * layout.pitch / horizon,
            y: layout.priceToY(prices[index])});
        const segment = (side, start, end) => paths[side].push(`M${start.x},${start.y} L${end.x},${end.y}`);
        for (let index = 1; index < prices.length && index <= horizon; index += 1) {
            if (!valid(prices[index - 1]) || !valid(prices[index])) continue;
            const start = point(index - 1);
            const end = point(index);
            const beforeUp = prices[index - 1] >= anchorPrice;
            const afterUp = prices[index] >= anchorPrice;
            if (beforeUp === afterUp) segment(beforeUp ? "up" : "down", start, end);
            else {
                const anchorY = layout.priceToY(anchorPrice);
                const fraction = (anchorY - start.y) / (end.y - start.y);
                const crossing = {x: start.x + fraction * (end.x - start.x), y: anchorY};
                segment(beforeUp ? "up" : "down", start, crossing);
                segment(afterUp ? "up" : "down", crossing, end);
            }
        }
        return {up: paths.up.join(" "), down: paths.down.join(" ")};
    };
    scope.WORTHWARD_PRICE_FIELD_DETAIL_CHART = Object.freeze({
        computeDirectForecastPriceDomain,
        computeLayout,
        buildObservedPaths,
    });
    if (typeof module !== "undefined" && module.exports) module.exports = scope.WORTHWARD_PRICE_FIELD_DETAIL_CHART;
})(typeof globalThis !== "undefined" ? globalThis : window);
