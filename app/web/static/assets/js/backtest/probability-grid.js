/**
 * Bayesian probability-grid geometry and interaction helpers.
 *
 * Code version: v0.18.0
 */
(function bootstrapBacktestProbabilityGrid(globalScope) {
    "use strict";

    const PRESENTATION_SCHEMA = "bayesian-price-field/v1";
    const RENDERER_ID = "probability-grid-v1";
    const DEFAULT_ROWS_ABOVE = 10;
    const DEFAULT_ROWS_BELOW = 10;
    const MAX_ROWS_PER_SIDE = 10;
    const DEFAULT_COLUMN_COUNT = 20;
    const DEFAULT_WIDTH_FRACTION = 0.25;
    const DEFAULT_GAP_PX = 2;
    const DEFAULT_PADDING_PX = 8;
    const DEFAULT_MIN_CELL_PX = 4;
    const CELL_OPACITY_MAPPING = "instant-contrast-power-v1";
    const DEFAULT_CELL_OPACITY_EXPONENT = 1.6;
    const DEFAULT_CELL_OPACITY_TAIL_RATIO = 0.02;
    const DEFAULT_CELL_DISPLAY_THRESHOLD_PCT = 5;
    const DEFAULT_MAX_CELL_PX = 10;

    const GEOMETRY_LIMITS = Object.freeze({
        columns: Object.freeze([1, 72]),
        gap: Object.freeze([0, 24]),
        minCell: Object.freeze([DEFAULT_MIN_CELL_PX, 32]),
        opacityExponent: Object.freeze([1.1, 4]),
        opacityTailRatio: Object.freeze([0, 0.25]),
        cellDisplayThresholdPct: Object.freeze([0, 50]),
        padding: Object.freeze([0, 64]),
        rows: Object.freeze([1, MAX_ROWS_PER_SIDE]),
    });

    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const finiteOrNull = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };
    const boundedNumber = (value, fallback, [minimum, maximum]) => {
        const numeric = finiteOrNull(value);
        return numeric === null ? fallback : clamp(numeric, minimum, maximum);
    };
    const boundedInteger = (value, fallback, limits) => {
        const numeric = finiteOrNull(value);
        return numeric !== null && Number.isInteger(numeric)
            ? clamp(numeric, limits[0], limits[1])
            : fallback;
    };
    const normalizeSymmetricRows = (rowsAbove, rowsBelow) => {
        const normalizedAbove = boundedInteger(
            rowsAbove,
            DEFAULT_ROWS_ABOVE,
            GEOMETRY_LIMITS.rows,
        );
        const normalizedBelow = boundedInteger(
            rowsBelow,
            DEFAULT_ROWS_BELOW,
            GEOMETRY_LIMITS.rows,
        );
        if (normalizedAbove !== normalizedBelow) {
            return Object.freeze({rowsAbove: DEFAULT_ROWS_ABOVE, rowsBelow: DEFAULT_ROWS_BELOW});
        }
        return Object.freeze({rowsAbove: normalizedAbove, rowsBelow: normalizedBelow});
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
        const presentation = {...value};
        // These fields belonged to the retired frosted-field material. Drop
        // them at the renderer boundary so stale cached payloads cannot
        // reintroduce radius or translucent-background behavior.
        delete presentation.cell_radius_px;
        delete presentation.tooltip_radius_px;
        delete presentation.tooltip_transparency_pct;
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
        const widthFraction = boundedNumber(value.width_fraction, DEFAULT_WIDTH_FRACTION, [0.1, 0.5]);
        const symmetricRows = normalizeSymmetricRows(value.rows_above, value.rows_below);
        return Object.freeze({
            ...presentation,
            schema: PRESENTATION_SCHEMA,
            renderer: RENDERER_ID,
            rows_above: symmetricRows.rowsAbove,
            rows_below: symmetricRows.rowsBelow,
            // The horizon density is a product-level chart contract, not a
            // user-tunable parameter. Every rendered field has 20 columns.
            columns: DEFAULT_COLUMN_COUNT,
            // The cell gap is a fixed 2 px visual contract. Keep the lower
            // geometry helpers parameterized for focused mathematical tests,
            // but do not allow a strategy payload to change the product gap.
            gap_px: DEFAULT_GAP_PX,
            padding_px: boundedNumber(value.padding_px, DEFAULT_PADDING_PX, GEOMETRY_LIMITS.padding),
            min_cell_px: boundedNumber(value.min_cell_px, DEFAULT_MIN_CELL_PX, GEOMETRY_LIMITS.minCell),
            cell_opacity_mapping: CELL_OPACITY_MAPPING,
            cell_opacity_exponent: boundedNumber(
                value.cell_opacity_exponent,
                DEFAULT_CELL_OPACITY_EXPONENT,
                GEOMETRY_LIMITS.opacityExponent,
            ),
            cell_opacity_tail_ratio: boundedNumber(
                value.cell_opacity_tail_ratio,
                DEFAULT_CELL_OPACITY_TAIL_RATIO,
                GEOMETRY_LIMITS.opacityTailRatio,
            ),
            cell_display_threshold_pct: boundedNumber(
                value.cell_display_threshold_pct,
                DEFAULT_CELL_DISPLAY_THRESHOLD_PCT,
                GEOMETRY_LIMITS.cellDisplayThresholdPct,
            ),
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
        rowsAbove = DEFAULT_ROWS_ABOVE,
        rowsBelow = DEFAULT_ROWS_BELOW,
        columnCount = DEFAULT_COLUMN_COUNT,
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
        const symmetricRows = normalizeSymmetricRows(rowsAbove, rowsBelow);
        const requestedRowsAbove = symmetricRows.rowsAbove;
        const requestedRowsBelow = symmetricRows.rowsBelow;
        // Keep the visible time lattice stable across every presentation. A
        // caller cannot change the product-owned 20-column density.
        const normalizedColumnCount = DEFAULT_COLUMN_COUNT;
        const plotWidth = right - left;
        const targetWidth = plotWidth * boundedNumber(widthFraction, DEFAULT_WIDTH_FRACTION, [0.1, 0.5]);
        const requestedGap = boundedNumber(gapPx, DEFAULT_GAP_PX, GEOMETRY_LIMITS.gap);
        const padding = boundedNumber(paddingPx, DEFAULT_PADDING_PX, GEOMETRY_LIMITS.padding);
        const minimumCell = boundedNumber(
            minCellPx,
            DEFAULT_MIN_CELL_PX,
            GEOMETRY_LIMITS.minCell,
        );

        // One slot is the visible square plus its following gap. Quantizing the
        // whole slot prevents spacing from accumulating a fractional-day drift.
        const preferredSlotWidth = Math.max(
            0,
            (targetWidth - (2 * padding) + requestedGap) / normalizedColumnCount,
        );
        const preferredDaysPerColumn = Math.max(
            0,
            Math.floor((preferredSlotWidth / normalizedStepPixels) + 1e-12),
        );
        let minimumDaysPerColumn = Math.max(
            1,
            Math.ceil(((minimumCell + requestedGap) / normalizedStepPixels) - 1e-12),
        );
        while ((minimumDaysPerColumn * normalizedStepPixels)
            < (minimumCell + requestedGap - 1e-9)) {
            minimumDaysPerColumn += 1;
        }
        const daysPerColumn = Math.max(preferredDaysPerColumn, minimumDaysPerColumn);
        const slotWidth = daysPerColumn * normalizedStepPixels;
        // Keep the requested gap exact. If the shortest valid day slot cannot
        // carry both the gap and the cell floor, add a complete trading day
        // to every fixed column instead of shrinking the gap.
        const gap = requestedGap;
        const cellSize = slotWidth - gap;
        // Count only complete cell slots after reserving the field's vertical
        // edge padding and its half-gap around the horizontal guide.
        const rowsThatFit = (distance) => {
            const numerator = Number(distance) - padding + (gap / 2);
            if (!(numerator > 0) || !(cellSize + gap > 0)) return 0;
            return Math.max(0, Math.floor((numerator / (cellSize + gap)) + 1e-9));
        };
        const availableRowsAbove = rowsThatFit(y - top);
        const availableRowsBelow = rowsThatFit(bottom - y);
        // Each side is independently capped by the smaller of ten rows, one
        // half of the current plot, and its own real chart boundary. The
        // half-plot cap prevents a near-edge guide from consuming the whole
        // vertical field while the boundary caps preserve exact clipping.
        const availableRowsWithinHalfPlot = rowsThatFit((bottom - top) / 2);
        const availableRowsPerSide = Math.min(
            MAX_ROWS_PER_SIDE,
            availableRowsWithinHalfPlot,
        );
        const normalizedRowsAbove = Math.min(
            requestedRowsAbove,
            availableRowsPerSide,
            availableRowsAbove,
        );
        const normalizedRowsBelow = Math.min(
            requestedRowsBelow,
            availableRowsPerSide,
            availableRowsBelow,
        );
        const sideCellExtent = (rowCount) => rowCount > 0
            ? (rowCount * cellSize)
                + ((rowCount - 1) * gap)
            : 0;
        const aboveCellExtent = sideCellExtent(normalizedRowsAbove);
        const belowCellExtent = sideCellExtent(normalizedRowsBelow);
        const guideGapAbove = normalizedRowsBelow > 0 ? gap / 2 : 0;
        const guideGapBelow = normalizedRowsAbove > 0 ? gap / 2 : 0;
        const aboveExtent = padding + aboveCellExtent + guideGapAbove;
        const belowExtent = padding + belowCellExtent + guideGapBelow;
        const height = aboveExtent + belowExtent;
        const halfHeight = height / 2;
        const rowCount = normalizedRowsAbove + normalizedRowsBelow;
        // The vertical guide and first field column share the same 2 px
        // logical gap as adjacent cells. Retain the strategy-owned outer
        // padding on the field's trailing edge and both vertical edges.
        const gridPaddingInlineStart = gap;
        const width = gridPaddingInlineStart + padding
            + (normalizedColumnCount * cellSize)
            + ((normalizedColumnCount - 1) * gap);
        return Object.freeze({
            anchorX: x,
            anchorY: y,
            availableRowsAbove,
            availableRowsBelow,
            availableRowsWithinHalfPlot,
            aboveExtent,
            availableRowsPerSide,
            belowExtent,
            gridPaddingInlineStart,
            gridPaddingTop: padding,
            gridPaddingBottom: padding,
            halfHeight,
            cellSize,
            columnCount: normalizedColumnCount,
            daysPerColumn,
            direction: "right",
            exceedsPreferredWidth: width > (targetWidth + 1e-9),
            gap,
            height,
            left: x,
            padding,
            requestedGap,
            rowCount,
            rowsAbove: normalizedRowsAbove,
            rowsBelow: normalizedRowsBelow,
            slotWidth,
            stepPixels: normalizedStepPixels,
            top: y - aboveExtent,
            width,
            widthTarget: targetWidth,
        });
    };

    const computeMaximumGridHalfHeight = ({
        rowsAbove = DEFAULT_ROWS_ABOVE,
        rowsBelow = DEFAULT_ROWS_BELOW,
        gapPx = DEFAULT_GAP_PX,
        paddingPx = DEFAULT_PADDING_PX,
        maxCellPx = DEFAULT_MAX_CELL_PX,
    } = {}) => {
        const symmetricRows = normalizeSymmetricRows(rowsAbove, rowsBelow);
        const gap = boundedNumber(gapPx, DEFAULT_GAP_PX, GEOMETRY_LIMITS.gap);
        const padding = boundedNumber(paddingPx, DEFAULT_PADDING_PX, GEOMETRY_LIMITS.padding);
        const requestedCellSize = finiteOrNull(maxCellPx);
        // This helper receives the actual horizontal lattice cell size from
        // computeGridGeometry. Do not clip it: an upper cap would silently
        // underestimate the overview minimum on a wide plot.
        const cellSize = requestedCellSize !== null && requestedCellSize > 0
            ? Math.max(1, requestedCellSize)
            : DEFAULT_MAX_CELL_PX;
        const sideExtent = (rowCount, oppositeRowCount) => rowCount > 0
            ? padding + (rowCount * cellSize) + ((rowCount - 1) * gap)
                + (oppositeRowCount > 0 ? gap / 2 : 0)
            : padding;
        return Math.max(
            sideExtent(symmetricRows.rowsAbove, symmetricRows.rowsBelow),
            sideExtent(symmetricRows.rowsBelow, symmetricRows.rowsAbove),
        );
    };

    const computeGridMinimumPlotHeight = ({
        chartArea,
        widthFraction = DEFAULT_WIDTH_FRACTION,
        gapPx = DEFAULT_GAP_PX,
        paddingPx = DEFAULT_PADDING_PX,
        minCellPx = DEFAULT_MIN_CELL_PX,
        rowsAbove = DEFAULT_ROWS_ABOVE,
        rowsBelow = DEFAULT_ROWS_BELOW,
        columnCount = DEFAULT_COLUMN_COUNT,
        stepPixels,
    } = {}) => {
        const top = Number(chartArea?.top);
        const bottom = Number(chartArea?.bottom);
        const left = Number(chartArea?.left);
        const right = Number(chartArea?.right);
        if (![top, bottom, left, right].every(Number.isFinite) || right <= left || bottom <= top) {
            return null;
        }
        // Probe the existing renderer at the vertical midpoint so the overview
        // contract inherits its exact quantized bar lattice rather than copying
        // any width, slot, or cell-size arithmetic.
        const geometry = computeGridGeometry({
            chartArea,
            anchorX: left,
            anchorY: (top + bottom) / 2,
            widthFraction,
            gapPx,
            paddingPx,
            minCellPx,
            rowsAbove,
            rowsBelow,
            columnCount,
            stepPixels,
        });
        if (!geometry) return null;
        const halfHeight = computeMaximumGridHalfHeight({
            rowsAbove,
            rowsBelow,
            gapPx: geometry.gap,
            paddingPx: geometry.padding,
            maxCellPx: geometry.cellSize,
        });
        return Object.freeze({
            cellSize: geometry.cellSize,
            chartAreaMinimumHeight: 2 * halfHeight,
            columnCount: geometry.columnCount,
            daysPerColumn: geometry.daysPerColumn,
            gap: geometry.gap,
            padding: geometry.padding,
            slotWidth: geometry.slotWidth,
            stepPixels: geometry.stepPixels,
        });
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

    const computeInstantOpacityProfile = (
        probabilities,
        {
            exponent = DEFAULT_CELL_OPACITY_EXPONENT,
            tailRatio = DEFAULT_CELL_OPACITY_TAIL_RATIO,
        } = {},
    ) => {
        if (!Array.isArray(probabilities) || !probabilities.length) return [];
        const sanitized = probabilities.map((value) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0;
        });
        const maximumProbability = Math.max(...sanitized);
        if (!(maximumProbability > 0)) {
            return sanitized.map((probability) => Object.freeze({
                displayIntensity: 0,
                opacity: 0,
                probability,
            }));
        }
        const minimumProbability = Math.min(...sanitized);
        const normalizedExponent = boundedNumber(
            exponent,
            DEFAULT_CELL_OPACITY_EXPONENT,
            GEOMETRY_LIMITS.opacityExponent,
        );
        const normalizedTailRatio = boundedNumber(
            tailRatio,
            DEFAULT_CELL_OPACITY_TAIL_RATIO,
            GEOMETRY_LIMITS.opacityTailRatio,
        );
        const minimumProbabilityRatio = minimumProbability / maximumProbability;
        const baselineRatio = Math.max(
            minimumProbabilityRatio,
            normalizedTailRatio,
        );
        const visibleRatioRange = 1 - baselineRatio;
        if (!(visibleRatioRange > 0)) {
            return sanitized.map((probability) => {
                const isMaximum = probability === maximumProbability;
                return Object.freeze({
                    displayIntensity: isMaximum ? 1 : 0,
                    opacity: isMaximum ? 1 : 0,
                    probability,
                });
            });
        }
        return sanitized.map((probability) => {
            if (probability === maximumProbability) {
                return Object.freeze({displayIntensity: 1, opacity: 1, probability});
            }
            const probabilityRatio = probability / maximumProbability;
            const displayIntensity = probabilityRatio <= baselineRatio
                ? 0
                : clamp(
                    (probabilityRatio - baselineRatio) / visibleRatioRange,
                    0,
                    1,
                );
            return Object.freeze({
                displayIntensity,
                opacity: displayIntensity > 0
                    ? Math.pow(displayIntensity, normalizedExponent)
                    : 0,
                probability,
            });
        });
    };

    const buildProbabilityCells = ({
        geometry,
        anchorPrice,
        mean,
        scale,
        stepPixels,
        valueForPixel,
        opacityExponent = DEFAULT_CELL_OPACITY_EXPONENT,
        opacityTailRatio = DEFAULT_CELL_OPACITY_TAIL_RATIO,
        cellDisplayThresholdPct = DEFAULT_CELL_DISPLAY_THRESHOLD_PCT,
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
        for (let row = 0; row < geometry.rowCount; row += 1) {
            const cellTop = geometry.top + geometry.gridPaddingTop
                + (row * (geometry.cellSize + geometry.gap));
            const cellBottom = cellTop + geometry.cellSize;
            const firstValue = Number(valueForPixel(cellTop));
            const secondValue = Number(valueForPixel(cellBottom));
            const lowerPrice = Math.min(firstValue, secondValue);
            const upperPrice = Math.max(firstValue, secondValue);
            const sign = row < geometry.rowsAbove ? "up" : "down";
            for (let distanceColumn = 0; distanceColumn < geometry.columnCount; distanceColumn += 1) {
                const visualColumn = distanceColumn;
                const x = geometry.left
                    + geometry.gridPaddingInlineStart
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
                    lowerPrice,
                    horizon,
                    probability,
                    row,
                    sign,
                    slotWidth,
                    upperPrice,
                    x,
                    y: cellTop,
                    yBottom: cellBottom,
                });
            }
        }
        const opacityProfile = computeInstantOpacityProfile(
            cells.map((cell) => cell.probability),
            {exponent: opacityExponent, tailRatio: opacityTailRatio},
        );
        const displayThresholdPct = boundedNumber(
            cellDisplayThresholdPct,
            DEFAULT_CELL_DISPLAY_THRESHOLD_PCT,
            GEOMETRY_LIMITS.cellDisplayThresholdPct,
        );
        return cells.map((cell, index) => ({
            ...cell,
            displayIntensity: opacityProfile[index]?.displayIntensity || 0,
            opacity: opacityProfile[index]?.opacity || 0,
            isVisible: (cell.probability * 100) >= displayThresholdPct,
            size: geometry.cellSize,
            symmetryOffset: (cell.y + (geometry.cellSize / 2)) - geometry.anchorY,
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
        BACKTEST_PROBABILITY_GRID_VERSION: "v0.18.0",
        DEFAULT_COLUMN_COUNT,
        MAX_ROWS_PER_SIDE,
        CELL_OPACITY_MAPPING,
        PRESENTATION_SCHEMA,
        RENDERER_ID,
        buildProbabilityCells,
        computeInstantOpacityProfile,
        computeGridMinimumPlotHeight,
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
