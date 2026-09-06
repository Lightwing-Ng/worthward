/* Code version: v1.1.0 */
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
    scope.WORTHWARD_PRICE_FIELD_DETAIL_CHART = Object.freeze({computeLayout});
    if (typeof module !== "undefined" && module.exports) module.exports = scope.WORTHWARD_PRICE_FIELD_DETAIL_CHART;
})(typeof globalThis !== "undefined" ? globalThis : window);
