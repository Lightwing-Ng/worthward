/**
 * Bayesian probability-grid geometry and interaction helpers.
 *
 * Code version: v0.4.0
 */
(function bootstrapBacktestProbabilityGrid(globalScope) {
    "use strict";

    const PRESENTATION_SCHEMA = "bayesian-price-field/v1";
    const RENDERER_ID = "probability-grid-v1";
    const DEFAULT_ROWS_ABOVE = 6;
    const DEFAULT_ROWS_BELOW = 6;
    const DEFAULT_WIDTH_FRACTION = 0.25;
    const DEFAULT_GAP_PX = 3;
    const DEFAULT_PADDING_PX = 8;
    const DEFAULT_MAX_CELL_PX = 10;

    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const finiteOrNull = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const normalizeExpectedSeriesContract = (expectedRawDatesOrOptions, expectedLength) => {
        let rawDates = null;
        let length = expectedLength;
        if (Array.isArray(expectedRawDatesOrOptions)) {
            rawDates = expectedRawDatesOrOptions;
        } else if (Number.isInteger(expectedRawDatesOrOptions)) {
            length = expectedRawDatesOrOptions;
        } else if (expectedRawDatesOrOptions && typeof expectedRawDatesOrOptions === "object") {
            const candidateRawDates = expectedRawDatesOrOptions.raw_dates
                ?? expectedRawDatesOrOptions.rawDates;
            rawDates = Array.isArray(candidateRawDates) ? candidateRawDates : null;
            length = expectedRawDatesOrOptions.length ?? expectedLength;
        }
        const normalizedLength = length !== null
            && length !== undefined
            && length !== ""
            && Number.isInteger(Number(length))
            && Number(length) >= 0
            ? Number(length)
            : (rawDates ? rawDates.length : null);
        return {rawDates, length: normalizedLength};
    };

    const normalizePresentation = (value, expectedRawDatesOrOptions = null, expectedLength = null) => {
        if (!value || typeof value !== "object") return null;
        if (String(value.schema || "") !== PRESENTATION_SCHEMA) return null;
        if (String(value.renderer || "") !== RENDERER_ID) return null;
        const expected = normalizeExpectedSeriesContract(expectedRawDatesOrOptions, expectedLength);
        const predictiveMean = Array.isArray(value.predictive_mean)
            ? value.predictive_mean.map(finiteOrNull)
            : [];
        const predictiveScale = Array.isArray(value.predictive_scale)
            ? value.predictive_scale.map((item) => {
                const numeric = finiteOrNull(item);
                return numeric !== null && numeric > 0 ? numeric : null;
            })
            : [];
        if (!predictiveMean.length || predictiveMean.length !== predictiveScale.length) return null;
        if (expected.length !== null && predictiveMean.length !== expected.length) return null;
        const hasDataKeys = Object.prototype.hasOwnProperty.call(value, "data_keys");
        let dataKeys;
        if (hasDataKeys) {
            if (!Array.isArray(value.data_keys) || !expected.rawDates) return null;
            dataKeys = [...value.data_keys];
            if (
                dataKeys.length !== predictiveMean.length
                || dataKeys.length !== expected.rawDates.length
                || dataKeys.some((key, index) => key !== expected.rawDates[index])
            ) return null;
        }
        const rowsAbove = clamp(Math.trunc(Number(value.rows_above) || DEFAULT_ROWS_ABOVE), 1, 12);
        const rowsBelow = clamp(Math.trunc(Number(value.rows_below) || DEFAULT_ROWS_BELOW), 1, 12);
        const widthFraction = clamp(Number(value.width_fraction) || DEFAULT_WIDTH_FRACTION, 0.1, 0.5);
        return Object.freeze({
            ...value,
            schema: PRESENTATION_SCHEMA,
            renderer: RENDERER_ID,
            rows_above: rowsAbove,
            rows_below: rowsBelow,
            width_fraction: widthFraction,
            predictive_mean: predictiveMean,
            predictive_scale: predictiveScale,
            ...(hasDataKeys ? {data_keys: dataKeys} : {}),
        });
    };

    // Abramowitz and Stegun 7.1.26; sufficient for visual probability mass.
    const normalCdf = (value) => {
        const z = Number(value);
        if (!Number.isFinite(z)) return z < 0 ? 0 : 1;
        const sign = z < 0 ? -1 : 1;
        const x = Math.abs(z) / Math.sqrt(2);
        const t = 1 / (1 + (0.3275911 * x));
        const coefficients = [
            0.254829592,
            -0.284496736,
            1.421413741,
            -1.453152027,
            1.061405429,
        ];
        const polynomial = (((((coefficients[4] * t) + coefficients[3]) * t + coefficients[2]) * t
            + coefficients[1]) * t + coefficients[0]) * t;
        const erf = sign * (1 - (polynomial * Math.exp(-(x * x))));
        return clamp(0.5 * (1 + erf), 0, 1);
    };

    const computeGridGeometry = ({
        chartArea,
        anchorX,
        anchorY,
        rowsAbove = DEFAULT_ROWS_ABOVE,
        rowsBelow = DEFAULT_ROWS_BELOW,
        widthFraction = DEFAULT_WIDTH_FRACTION,
        gapPx = DEFAULT_GAP_PX,
        paddingPx = DEFAULT_PADDING_PX,
        maxCellPx = DEFAULT_MAX_CELL_PX,
    } = {}) => {
        const left = Number(chartArea?.left);
        const right = Number(chartArea?.right);
        const top = Number(chartArea?.top);
        const bottom = Number(chartArea?.bottom);
        const x = Number(anchorX);
        const y = Number(anchorY);
        if (![left, right, top, bottom, x, y].every(Number.isFinite) || right <= left || bottom <= top) {
            return null;
        }
        const rowCount = clamp(Math.trunc(rowsAbove) + Math.trunc(rowsBelow), 2, 24);
        const plotWidth = right - left;
        const plotHeight = bottom - top;
        const targetWidth = plotWidth * clamp(Number(widthFraction), 0.1, 0.5);
        const gap = clamp(Number(gapPx) || DEFAULT_GAP_PX, 1, Math.max(1, targetWidth / 12));
        const padding = clamp(Number(paddingPx) || DEFAULT_PADDING_PX, 0, Math.max(0, targetWidth / 4));
        const innerWidth = Math.max(1, targetWidth - (2 * padding));
        const maxCellByHeight = Math.max(
            1,
            (plotHeight - (2 * padding) - ((rowCount - 1) * gap)) / rowCount,
        );
        const cellLimit = Math.max(1, Math.min(Number(maxCellPx) || DEFAULT_MAX_CELL_PX, maxCellByHeight));
        let columnCount = 1;
        let cellSize = innerWidth;
        while (columnCount < 64 && cellSize > cellLimit) {
            columnCount += 1;
            cellSize = (innerWidth - ((columnCount - 1) * gap)) / columnCount;
        }
        while (columnCount > 1 && cellSize <= 0) {
            columnCount -= 1;
            cellSize = (innerWidth - ((columnCount - 1) * gap)) / columnCount;
        }
        if (!(cellSize > 0)) return null;
        const height = (2 * padding) + (rowCount * cellSize) + ((rowCount - 1) * gap);
        return Object.freeze({
            anchorX: x,
            anchorY: y,
            cellSize,
            columnCount,
            direction: "right",
            gap,
            height,
            left: x,
            padding,
            rowCount,
            rowsAbove: Math.trunc(rowsAbove),
            rowsBelow: Math.trunc(rowsBelow),
            top: y - (height / 2),
            width: targetWidth,
        });
    };

    const computeMaximumGridHalfHeight = ({
        rowsAbove = DEFAULT_ROWS_ABOVE,
        rowsBelow = DEFAULT_ROWS_BELOW,
        gapPx = DEFAULT_GAP_PX,
        paddingPx = DEFAULT_PADDING_PX,
        maxCellPx = DEFAULT_MAX_CELL_PX,
    } = {}) => {
        const rowCount = clamp(Math.trunc(rowsAbove) + Math.trunc(rowsBelow), 2, 24);
        const gap = Math.max(0, Number(gapPx) || DEFAULT_GAP_PX);
        const padding = Math.max(0, Number(paddingPx) || DEFAULT_PADDING_PX);
        const cellSize = Math.max(1, Number(maxCellPx) || DEFAULT_MAX_CELL_PX);
        return padding + (
            (rowCount * cellSize) + ((rowCount - 1) * gap)
        ) / 2;
    };

    const resolveDatasetStepPixels = (points, anchorIndex) => {
        if (!Array.isArray(points) || !Number.isInteger(anchorIndex) || anchorIndex < 0) return null;
        const anchorX = Number(points[anchorIndex]?.x);
        if (!Number.isFinite(anchorX)) return null;
        for (let distance = 1; distance < points.length; distance += 1) {
            const futureX = Number(points[anchorIndex + distance]?.x);
            if (Number.isFinite(futureX) && futureX > anchorX) {
                return (futureX - anchorX) / distance;
            }
            const pastX = Number(points[anchorIndex - distance]?.x);
            if (Number.isFinite(pastX) && pastX < anchorX) {
                return (anchorX - pastX) / distance;
            }
        }
        return null;
    };

    const probabilityBetweenPrices = ({anchorPrice, lowerPrice, upperPrice, mean, scale, horizon}) => {
        const anchor = Number(anchorPrice);
        const lower = Number(lowerPrice);
        const upper = Number(upperPrice);
        const oneStepMean = Number(mean);
        const oneStepScale = Number(scale);
        const steps = Number(horizon);
        if (!(anchor > 0) || !(lower > 0) || !(upper > lower) || !(oneStepScale > 0)
            || !Number.isFinite(steps) || !(steps > 0)) {
            return 0;
        }
        const cumulativeMean = oneStepMean * steps;
        const cumulativeScale = oneStepScale * Math.sqrt(steps);
        const lowerZ = (Math.log(lower / anchor) - cumulativeMean) / cumulativeScale;
        const upperZ = (Math.log(upper / anchor) - cumulativeMean) / cumulativeScale;
        return clamp(normalCdf(upperZ) - normalCdf(lowerZ), 0, 1);
    };

    const buildProbabilityCells = ({
        geometry,
        anchorPrice,
        mean,
        scale,
        stepPixels,
        valueForPixel,
    } = {}) => {
        const normalizedStepPixels = Number(stepPixels);
        if (!geometry || typeof valueForPixel !== "function"
            || !Number.isFinite(normalizedStepPixels) || !(normalizedStepPixels > 0)) return [];
        const cells = [];
        const centralGapCenter = geometry.padding
            + (geometry.rowsAbove * geometry.cellSize)
            + ((geometry.rowsAbove - 0.5) * geometry.gap);
        for (let row = 0; row < geometry.rowCount; row += 1) {
            const cellTop = geometry.top + geometry.padding + (row * (geometry.cellSize + geometry.gap));
            const cellBottom = cellTop + geometry.cellSize;
            const firstValue = Number(valueForPixel(cellTop));
            const secondValue = Number(valueForPixel(cellBottom));
            const lowerPrice = Math.min(firstValue, secondValue);
            const upperPrice = Math.max(firstValue, secondValue);
            const sign = row < geometry.rowsAbove ? "up" : "down";
            for (let distanceColumn = 0; distanceColumn < geometry.columnCount; distanceColumn += 1) {
                const visualColumn = distanceColumn;
                const x = geometry.left
                    + geometry.padding
                    + (visualColumn * (geometry.cellSize + geometry.gap));
                const centerX = x + (geometry.cellSize / 2);
                const horizon = (centerX - geometry.anchorX) / normalizedStepPixels;
                const probability = probabilityBetweenPrices({
                    anchorPrice,
                    lowerPrice,
                    upperPrice,
                    mean,
                    scale,
                    horizon,
                });
                cells.push({
                    centerX,
                    column: visualColumn,
                    horizon,
                    probability,
                    row,
                    sign,
                    x,
                    y: cellTop,
                });
            }
        }
        return cells.map((cell) => ({
            ...cell,
            opacity: cell.probability,
            size: geometry.cellSize,
            symmetryOffset: (cell.y + (geometry.cellSize / 2)) - (geometry.top + centralGapCenter),
        }));
    };

    const reducePinState = (state, action) => {
        const current = state && typeof state === "object"
            ? state
            : {mode: "tracking", activeIndex: null};
        if (action?.type === "pin" && Number.isInteger(action.index)) {
            return Object.freeze({mode: "pinned", activeIndex: action.index});
        }
        if (action?.type === "track" && current.mode !== "pinned") {
            return Object.freeze({
                mode: "tracking",
                activeIndex: Number.isInteger(action.index) ? action.index : null,
            });
        }
        if (action?.type === "clear") {
            return Object.freeze({mode: "tracking", activeIndex: null});
        }
        return current;
    };

    const isPointNearCurve = (pointerY, curveY, tolerancePx = 14) => (
        Number.isFinite(Number(pointerY))
        && Number.isFinite(Number(curveY))
        && Math.abs(Number(pointerY) - Number(curveY)) <= Math.max(0, Number(tolerancePx) || 0)
    );

    const api = Object.freeze({
        BACKTEST_PROBABILITY_GRID_VERSION: "v0.4.0",
        PRESENTATION_SCHEMA,
        RENDERER_ID,
        buildProbabilityCells,
        computeMaximumGridHalfHeight,
        computeGridGeometry,
        isPointNearCurve,
        normalCdf,
        normalizePresentation,
        probabilityBetweenPrices,
        reducePinState,
        resolveDatasetStepPixels,
    });

    globalScope.ANTIGRAVITY_BACKTEST_PROBABILITY_GRID = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
