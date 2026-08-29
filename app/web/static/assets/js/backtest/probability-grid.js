/**
 * Bayesian probability-grid geometry and interaction helpers.
 *
 * Code version: v0.5.0
 */
(function bootstrapBacktestProbabilityGrid(globalScope) {
    "use strict";

    const PRESENTATION_SCHEMA = "bayesian-price-field/v1";
    const RENDERER_ID = "probability-grid-v1";
    const DEFAULT_ROWS_ABOVE = 6;
    const DEFAULT_ROWS_BELOW = 6;
    const DEFAULT_COLUMN_COUNT = 36;
    const DEFAULT_WIDTH_FRACTION = 0.25;
    const DEFAULT_GAP_PX = 3;
    const DEFAULT_PADDING_PX = 8;
    const DEFAULT_MIN_CELL_PX = 4;
    const DEFAULT_CELL_RADIUS_PX = 2;
    const DEFAULT_TOOLTIP_RADIUS_PX = 10;
    const DEFAULT_TOOLTIP_TRANSPARENCY_PCT = 90;
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
        const widthFraction = clamp(Number(value.width_fraction) || DEFAULT_WIDTH_FRACTION, 0.1, 0.5);
        return Object.freeze({
            ...value,
            schema: PRESENTATION_SCHEMA,
            renderer: RENDERER_ID,
            rows_above: DEFAULT_ROWS_ABOVE,
            rows_below: DEFAULT_ROWS_BELOW,
            columns: DEFAULT_COLUMN_COUNT,
            gap_px: DEFAULT_GAP_PX,
            padding_px: DEFAULT_PADDING_PX,
            min_cell_px: DEFAULT_MIN_CELL_PX,
            cell_radius_px: DEFAULT_CELL_RADIUS_PX,
            tooltip_radius_px: DEFAULT_TOOLTIP_RADIUS_PX,
            tooltip_transparency_pct: DEFAULT_TOOLTIP_TRANSPARENCY_PCT,
            time_quantization: "integer-trading-days",
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
        widthFraction = DEFAULT_WIDTH_FRACTION,
        gapPx = DEFAULT_GAP_PX,
        paddingPx = DEFAULT_PADDING_PX,
        minCellPx = DEFAULT_MIN_CELL_PX,
        stepPixels,
    } = {}) => {
        const left = Number(chartArea?.left);
        const right = Number(chartArea?.right);
        const top = Number(chartArea?.top);
        const bottom = Number(chartArea?.bottom);
        const x = Number(anchorX);
        const y = Number(anchorY);
        const normalizedStepPixels = Number(stepPixels);
        if (![left, right, top, bottom, x, y, normalizedStepPixels].every(Number.isFinite)
            || right <= left || bottom <= top || !(normalizedStepPixels > 0)) {
            return null;
        }
        const rowCount = DEFAULT_ROWS_ABOVE + DEFAULT_ROWS_BELOW;
        const plotWidth = right - left;
        const targetWidth = plotWidth * clamp(Number(widthFraction), 0.1, 0.5);
        const gapCandidate = Number(gapPx);
        const gap = Number.isFinite(gapCandidate) ? Math.max(0, gapCandidate) : DEFAULT_GAP_PX;
        const paddingCandidate = Number(paddingPx);
        const padding = Number.isFinite(paddingCandidate)
            ? Math.max(0, paddingCandidate)
            : DEFAULT_PADDING_PX;
        const minimumCellCandidate = Number(minCellPx);
        const minimumCell = Number.isFinite(minimumCellCandidate)
            ? Math.max(DEFAULT_MIN_CELL_PX, minimumCellCandidate)
            : DEFAULT_MIN_CELL_PX;

        // One slot is the visible square plus its following gap. Quantizing the
        // whole slot prevents spacing from accumulating a fractional-day drift.
        const preferredSlotWidth = Math.max(
            0,
            (targetWidth - (2 * padding) + gap) / DEFAULT_COLUMN_COUNT,
        );
        const preferredDaysPerColumn = Math.max(
            0,
            Math.floor((preferredSlotWidth / normalizedStepPixels) + 1e-12),
        );
        let minimumDaysPerColumn = Math.max(
            1,
            Math.ceil((gap + minimumCell) / normalizedStepPixels),
        );
        while (((minimumDaysPerColumn * normalizedStepPixels) - gap) < minimumCell) {
            minimumDaysPerColumn += 1;
        }
        const daysPerColumn = Math.max(preferredDaysPerColumn, minimumDaysPerColumn);
        const slotWidth = daysPerColumn * normalizedStepPixels;
        const cellSize = slotWidth - gap;
        const columnCount = DEFAULT_COLUMN_COUNT;
        const width = (2 * padding)
            + (columnCount * cellSize)
            + ((columnCount - 1) * gap);
        const height = (2 * padding) + (rowCount * cellSize) + ((rowCount - 1) * gap);
        return Object.freeze({
            anchorX: x,
            anchorY: y,
            cellSize,
            columnCount,
            daysPerColumn,
            direction: "right",
            exceedsPreferredWidth: width > (targetWidth + 1e-9),
            gap,
            height,
            left: x,
            padding,
            rowCount,
            rowsAbove: DEFAULT_ROWS_ABOVE,
            rowsBelow: DEFAULT_ROWS_BELOW,
            slotWidth,
            stepPixels: normalizedStepPixels,
            top: y - (height / 2),
            width,
            widthTarget: targetWidth,
        });
    };

    const computeMaximumGridHalfHeight = ({
        gapPx = DEFAULT_GAP_PX,
        paddingPx = DEFAULT_PADDING_PX,
        maxCellPx = DEFAULT_MAX_CELL_PX,
    } = {}) => {
        const rowCount = DEFAULT_ROWS_ABOVE + DEFAULT_ROWS_BELOW;
        const gap = Math.max(0, Number(gapPx) || DEFAULT_GAP_PX);
        const padding = Math.max(0, Number(paddingPx) || DEFAULT_PADDING_PX);
        const cellSize = Math.max(1, Number(maxCellPx) || DEFAULT_MAX_CELL_PX);
        return padding + (
            (rowCount * cellSize) + ((rowCount - 1) * gap)
        ) / 2;
    };

    const resolveDatasetStepPixels = (points, anchorIndex) => {
        if (!Array.isArray(points) || !Number.isInteger(anchorIndex)
            || anchorIndex < 0 || anchorIndex >= points.length
            || !Number.isFinite(Number(points[anchorIndex]?.x))) return null;
        const positiveSteps = [];
        let previousPoint = null;
        points.forEach((point, index) => {
            const pointX = Number(point?.x);
            if (!Number.isFinite(pointX)) return;
            if (previousPoint) {
                const indexDistance = index - previousPoint.index;
                const normalizedStep = (pointX - previousPoint.x) / indexDistance;
                if (indexDistance > 0 && Number.isFinite(normalizedStep) && normalizedStep > 0) {
                    positiveSteps.push(normalizedStep);
                }
            }
            previousPoint = {index, x: pointX};
        });
        if (!positiveSteps.length) return null;
        positiveSteps.sort((leftStep, rightStep) => leftStep - rightStep);
        const midpoint = Math.floor(positiveSteps.length / 2);
        return positiveSteps.length % 2 === 1
            ? positiveSteps[midpoint]
            : (positiveSteps[midpoint - 1] + positiveSteps[midpoint]) / 2;
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
        const geometryStepPixels = Number(geometry?.stepPixels);
        const daysPerColumn = Number(geometry?.daysPerColumn);
        const slotWidth = Number(geometry?.slotWidth);
        if (!geometry || typeof valueForPixel !== "function"
            || !Number.isFinite(normalizedStepPixels) || !(normalizedStepPixels > 0)
            || !Number.isFinite(geometryStepPixels) || !(geometryStepPixels > 0)
            || Math.abs(geometryStepPixels - normalizedStepPixels) > 1e-9
            || !Number.isInteger(daysPerColumn) || daysPerColumn < 1
            || !Number.isFinite(slotWidth) || !(slotWidth > geometry.gap)) return [];
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
                    + (visualColumn * slotWidth);
                const centerX = x + (geometry.cellSize / 2);
                const horizon = (visualColumn + 1) * daysPerColumn;
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
                    daysPerColumn,
                    horizon,
                    probability,
                    row,
                    sign,
                    slotWidth,
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
        BACKTEST_PROBABILITY_GRID_VERSION: "v0.5.0",
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
