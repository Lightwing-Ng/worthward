/* Code version: v1.2.0 */
/** Shared square-cell layout with equal historical and forecast time spans. */
(function bootstrapPriceFieldDetailChart(scope) {
    "use strict";
    const computeLayout = ({width, height, anchorPrice, lowerPrice, upperPrice,
        rowsAbove, rowsBelow, columns, history = [], horizon = history.length - 1,
        gap = 2, padding = 2}) => {
        const rowCount = rowsAbove + rowsBelow;
        const priceStep = (upperPrice - lowerPrice) / rowCount;
        if (![width, height, priceStep, columns, horizon].every(Number.isFinite)
            || !(width > 0 && height > 0 && priceStep > 0 && columns > 0 && horizon > 0)
            || !Number.isFinite(anchorPrice)) return null;
        const anchorX = width / 2;
        const anchorY = height / 2;
        const pitch = Math.min((anchorX - padding) / columns,
            (anchorY - padding) / Math.max(rowsAbove, rowsBelow));
        if (!(pitch > 0)) return null;
        const cellGap = Math.min(gap, pitch / 2);
        const cellSize = pitch - cellGap;
        const scale = pitch / priceStep;
        const priceToY = (price) => anchorY - (price - anchorPrice) * scale;
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
            minPrice: anchorPrice - anchorY / scale,
            maxPrice: anchorPrice + anchorY / scale,
            priceToY, historyX});
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
                const fraction = (anchorPrice - prices[index - 1]) / (prices[index] - prices[index - 1]);
                const crossing = {x: start.x + fraction * (end.x - start.x), y: layout.priceToY(anchorPrice)};
                segment(beforeUp ? "up" : "down", start, crossing);
                segment(afterUp ? "up" : "down", crossing, end);
            }
        }
        return {up: paths.up.join(" "), down: paths.down.join(" ")};
    };
    scope.WORTHWARD_PRICE_FIELD_DETAIL_CHART = Object.freeze({computeLayout, buildObservedPaths});
    if (typeof module !== "undefined" && module.exports) module.exports = scope.WORTHWARD_PRICE_FIELD_DETAIL_CHART;
})(typeof globalThis !== "undefined" ? globalThis : window);
