/**
 * Shared probability-grid geometry and interaction helpers.
 *
 * Bayesian and LSTM Price Field strategies emit this renderer payload.
 * Layout, hover, pin, resize, thresholding, and styling live only here.
 *
 * Code version: v0.28.0
 */
(function bootstrapBacktestProbabilityGrid(globalScope) {
    "use strict";

    const BAYESIAN_PRESENTATION_SCHEMA = "bayesian-price-field/v1";
    const LSTM_PRESENTATION_SCHEMA = "lstm-price-field/v1";
    const PRESENTATION_SCHEMAS = Object.freeze([
        BAYESIAN_PRESENTATION_SCHEMA,
        LSTM_PRESENTATION_SCHEMA,
    ]);
    const PRESENTATION_SCHEMA = BAYESIAN_PRESENTATION_SCHEMA;
    const PRICE_FIELD_STRATEGY_IDS = Object.freeze([
        "bayesian-price-field",
        "lstm-price-field",
    ]);
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
    const MAX_TARGET_CELL_PX = 64;
    const MAX_ABS_AUTOREGRESSION = 0.95;

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
        const schema = String(value.schema || "");
        if (!PRESENTATION_SCHEMAS.includes(schema)) return null;
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
        const usesDynamicReturnState = String(value.multi_step_kind || "")
            === "causal-ar1-return-state";
        const normalizeStateSeries = (rawValues, fallbackBuilder, validator) => {
            if (!Array.isArray(rawValues)) {
                return usesDynamicReturnState
                    ? null
                    : predictiveMean.map((item, index) => (
                        item === null ? null : fallbackBuilder(index)
                    ));
            }
            if (rawValues.length !== predictiveMean.length) return null;
            return rawValues.map((item, index) => {
                if (predictiveMean[index] === null) return null;
                const numeric = finiteOrNull(item);
                return numeric !== null && validator(numeric) ? numeric : null;
            });
        };
        const returnAutoregression = normalizeStateSeries(
            value.return_autoregression,
            () => 0,
            (numeric) => Math.abs(numeric) <= MAX_ABS_AUTOREGRESSION,
        );
        const returnLongRunMean = normalizeStateSeries(
            value.return_long_run_mean,
            () => 0,
            () => true,
        );
        const returnInnovationScale = normalizeStateSeries(
            value.return_innovation_scale,
            (index) => predictiveScale[index],
            (numeric) => numeric > 0,
        );
        if (!returnAutoregression || !returnLongRunMean || !returnInnovationScale) return null;
        if (usesDynamicReturnState && predictiveMean.some((mean, index) => (
            mean !== null && (
                returnAutoregression[index] === null
                || returnLongRunMean[index] === null
                || returnInnovationScale[index] === null
            )
        ))) return null;
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
            schema,
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
            return_autoregression: returnAutoregression,
            return_long_run_mean: returnLongRunMean,
            return_innovation_scale: returnInnovationScale,
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
        cellSizeTargetPx = null,
        limitRowsToChartArea = true,
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
        const requestedCellSizeTarget = finiteOrNull(cellSizeTargetPx);
        const normalizedCellSizeTarget = requestedCellSizeTarget !== null
            ? clamp(
                requestedCellSizeTarget,
                minimumCell,
                MAX_TARGET_CELL_PX,
            )
            : null;

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
        let targetDaysPerColumn = 0;
        if (normalizedCellSizeTarget !== null) {
            targetDaysPerColumn = Math.max(
                1,
                Math.ceil(
                    ((normalizedCellSizeTarget + requestedGap) / normalizedStepPixels)
                        - 1e-12,
                ),
            );
            while ((targetDaysPerColumn * normalizedStepPixels)
                < (normalizedCellSizeTarget + requestedGap - 1e-9)) {
                targetDaysPerColumn += 1;
            }
        }
        const daysPerColumn = Math.max(
            preferredDaysPerColumn,
            minimumDaysPerColumn,
            targetDaysPerColumn,
        );
        const slotWidth = daysPerColumn * normalizedStepPixels;
        // Keep the requested gap exact. If the shortest valid day slot cannot
        // carry both the gap and the cell floor, add a complete trading day
        // to every fixed column instead of shrinking the gap.
        const gap = requestedGap;
        const cellSize = slotWidth - gap;
        // Count only complete cell slots after reserving the field's vertical
        // edge padding and its half-gap around the horizontal guide. Ten rows
        // per side therefore require the published plot minimum; shrinking that
        // minimum in the shared splitter is what drops a 10-row field to 8.
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
        const normalizedRowsAbove = limitRowsToChartArea
            ? Math.min(
                requestedRowsAbove,
                availableRowsPerSide,
                availableRowsAbove,
            )
            : requestedRowsAbove;
        const normalizedRowsBelow = limitRowsToChartArea
            ? Math.min(
                requestedRowsBelow,
                availableRowsPerSide,
                availableRowsBelow,
            )
            : requestedRowsBelow;
        const sideCellExtent = (rowCount) => rowCount > 0
            ? (rowCount * cellSize)
                + ((rowCount - 1) * gap)
            : 0;
        const aboveCellExtent = sideCellExtent(normalizedRowsAbove);
        const belowCellExtent = sideCellExtent(normalizedRowsBelow);
        // Keep the first cell on its semantic side of the guide even when the
        // chart boundary leaves only one side of the field visible. With both
        // sides present, the CSS grid gap is split around the guide. With one
        // side absent, the empty side gives back its half-gap so the remaining
        // side still starts or ends exactly half a gap away from the guide.
        const guideGap = gap / 2;
        const aboveExtent = normalizedRowsAbove > 0
            ? padding + aboveCellExtent + guideGap
            : padding - (normalizedRowsBelow > 0 ? guideGap : 0);
        const belowExtent = normalizedRowsBelow > 0
            ? padding + belowCellExtent + guideGap
            : padding - (normalizedRowsAbove > 0 ? guideGap : 0);
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
            cellSizeTarget: normalizedCellSizeTarget,
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
        cellSizeTargetPx = null,
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
            cellSizeTargetPx,
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

    const computeAnchoredDetailGridPosition = ({
        viewportHeight,
        rowsAbove = DEFAULT_ROWS_ABOVE,
        rowsBelow = DEFAULT_ROWS_BELOW,
        cellSize,
        gapPx = DEFAULT_GAP_PX,
        paddingPx = DEFAULT_PADDING_PX,
    } = {}) => {
        const height = Number(viewportHeight);
        const normalizedCellSize = Number(cellSize);
        const gap = boundedNumber(gapPx, DEFAULT_GAP_PX, GEOMETRY_LIMITS.gap);
        const padding = boundedNumber(paddingPx, DEFAULT_PADDING_PX, GEOMETRY_LIMITS.padding);
        const normalizedRowsAbove = boundedInteger(
            rowsAbove,
            DEFAULT_ROWS_ABOVE,
            [0, MAX_ROWS_PER_SIDE],
        );
        const normalizedRowsBelow = boundedInteger(
            rowsBelow,
            DEFAULT_ROWS_BELOW,
            [0, MAX_ROWS_PER_SIDE],
        );
        if (!(height > 0) || !(normalizedCellSize > 0)) return null;
        const sideCellExtent = (rowCount) => rowCount > 0
            ? (rowCount * normalizedCellSize) + ((rowCount - 1) * gap)
            : 0;
        const aboveCellExtent = sideCellExtent(normalizedRowsAbove);
        const belowCellExtent = sideCellExtent(normalizedRowsBelow);
        // Mirror computeGridGeometry so the detail panel and the hover field
        // place one-sided cells on the same side of the horizontal guide.
        const guideGap = gap / 2;
        const aboveExtent = normalizedRowsAbove > 0
            ? padding + aboveCellExtent + guideGap
            : padding - (normalizedRowsBelow > 0 ? guideGap : 0);
        const belowExtent = normalizedRowsBelow > 0
            ? padding + belowCellExtent + guideGap
            : padding - (normalizedRowsAbove > 0 ? guideGap : 0);
        const anchorY = height / 2;
        return Object.freeze({
            anchorY,
            aboveExtent,
            belowExtent,
            height: aboveExtent + belowExtent,
            top: anchorY - aboveExtent,
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

    const multiStepNormalParameters = ({
        mean,
        scale,
        horizon,
        autoregression = 0,
        longRunMean = 0,
        innovationScale = scale,
    } = {}) => {
        const oneStepMean = Number(mean);
        const oneStepScale = Number(scale);
        const steps = Number(horizon);
        const phi = clamp(Number(autoregression), -MAX_ABS_AUTOREGRESSION, MAX_ABS_AUTOREGRESSION);
        const equilibriumMean = Number(longRunMean);
        const nextInnovationScale = Number(innovationScale);
        if (!Number.isFinite(oneStepMean) || !(oneStepScale > 0)
            || !Number.isInteger(steps) || !(steps > 0)
            || !Number.isFinite(phi) || !Number.isFinite(equilibriumMean)
            || !(nextInnovationScale > 0)) return null;
        let stateMean = oneStepMean;
        let stateVariance = oneStepScale * oneStepScale;
        let cumulativeMean = stateMean;
        let cumulativeVariance = stateVariance;
        let cumulativeStateCovariance = stateVariance;
        const innovationVariance = nextInnovationScale * nextInnovationScale;
        for (let step = 1; step < steps; step += 1) {
            stateMean = equilibriumMean + (phi * (stateMean - equilibriumMean));
            const nextStateVariance = (phi * phi * stateVariance) + innovationVariance;
            const previousCumulativeNextStateCovariance = phi * cumulativeStateCovariance;
            cumulativeMean += stateMean;
            cumulativeVariance += nextStateVariance
                + (2 * previousCumulativeNextStateCovariance);
            cumulativeStateCovariance = previousCumulativeNextStateCovariance
                + nextStateVariance;
            stateVariance = nextStateVariance;
        }
        return Object.freeze({
            mean: cumulativeMean,
            scale: Math.sqrt(Math.max(Number.EPSILON, cumulativeVariance)),
        });
    };

    const probabilityBetweenPrices = ({
        anchorPrice,
        lowerPrice,
        upperPrice,
        mean,
        scale,
        horizon,
        autoregression,
        longRunMean,
        innovationScale,
    }) => {
        const anchor = Number(anchorPrice);
        const lower = Number(lowerPrice);
        const upper = Number(upperPrice);
        const forecast = multiStepNormalParameters({
            mean,
            scale,
            horizon,
            autoregression,
            longRunMean,
            innovationScale,
        });
        if (!(anchor > 0) || !(lower > 0) || !(upper > lower) || !forecast) {
            return 0;
        }
        const lowerZ = (Math.log(lower / anchor) - forecast.mean) / forecast.scale;
        const upperZ = (Math.log(upper / anchor) - forecast.mean) / forecast.scale;
        return clamp(normalCdf(upperZ) - normalCdf(lowerZ), 0, 1);
    };

    const computeInstantOpacityProfile = (
        probabilities,
        {
            exponent = DEFAULT_CELL_OPACITY_EXPONENT,
            tailRatio = DEFAULT_CELL_OPACITY_TAIL_RATIO,
            displayFloor = null,
        } = {},
    ) => {
        if (!Array.isArray(probabilities) || !probabilities.length) return [];
        const sanitized = probabilities.map((value) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0;
        });
        const maximumProbability = Math.max(...sanitized);
        if (!(maximumProbability > 0) || (displayFloor !== null && Number(displayFloor) > maximumProbability)) {
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
        const baselineRatio = displayFloor !== null && Number.isFinite(Number(displayFloor))
            ? clamp(Number(displayFloor), 0, 1) / maximumProbability
            : Math.max(minimumProbabilityRatio, normalizedTailRatio);
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
        autoregression = 0,
        longRunMean = 0,
        innovationScale = scale,
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
            const normalizedAnchorPrice = Number(anchorPrice);
            const sign = Number.isFinite(normalizedAnchorPrice)
                && Number.isFinite(lowerPrice)
                ? (lowerPrice >= normalizedAnchorPrice ? "up" : "down")
                : (row < geometry.rowsAbove ? "up" : "down");
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
                    autoregression,
                    longRunMean,
                    innovationScale,
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
        const displayThresholdPct = boundedNumber(
            cellDisplayThresholdPct,
            DEFAULT_CELL_DISPLAY_THRESHOLD_PCT,
            GEOMETRY_LIMITS.cellDisplayThresholdPct,
        );
        const opacityProfile = computeInstantOpacityProfile(
            cells.map((cell) => cell.probability),
            {exponent: opacityExponent, tailRatio: opacityTailRatio, displayFloor: displayThresholdPct / 100},
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

    // The contained detail view reports raw probability mass for one price
    // row across every forecast horizon. Threshold-hidden cells remain part
    // of the row so the readout reflects the complete model lattice.
    const summarizeProbabilityRow = (cells, row) => {
        const normalizedRow = finiteOrNull(row);
        if (!Array.isArray(cells) || normalizedRow === null || !Number.isInteger(normalizedRow)) {
            return null;
        }
        const rowCells = cells.filter((cell) => Number(cell?.row) === normalizedRow);
        if (!rowCells.length) return null;
        let lowerPrice = Number.POSITIVE_INFINITY;
        let upperPrice = Number.NEGATIVE_INFINITY;
        let cumulativeProbability = 0;
        let hiddenCellCount = 0;
        rowCells.forEach((cell) => {
            const lower = finiteOrNull(cell?.lowerPrice);
            const upper = finiteOrNull(cell?.upperPrice);
            if (lower !== null) lowerPrice = Math.min(lowerPrice, lower);
            if (upper !== null) upperPrice = Math.max(upperPrice, upper);
            const probability = finiteOrNull(cell?.probability);
            if (probability !== null) cumulativeProbability += Math.max(0, probability);
            if (cell?.isVisible === false) hiddenCellCount += 1;
        });
        if (!Number.isFinite(lowerPrice) || !Number.isFinite(upperPrice)) return null;
        return Object.freeze({
            row: normalizedRow,
            lowerPrice,
            upperPrice,
            cumulativeProbability,
            cellCount: rowCells.length,
            hiddenCellCount,
        });
    };

    // Normalize each horizon's complete lattice before averaging directions.
    // These are conditional shares of represented mass, not full-distribution
    // tail probabilities. Threshold visibility never changes the denominator.
    const summarizeProbabilityField = (cells) => {
        if (!Array.isArray(cells) || !cells.length) return null;
        let upCellCount = 0;
        let downCellCount = 0;
        let upHiddenCellCount = 0;
        let downHiddenCellCount = 0;
        const horizonMass = new Map();
        cells.forEach((cell) => {
            const probability = finiteOrNull(cell?.probability);
            if (probability === null) return;
            const normalizedProbability = Math.max(0, probability);
            let direction = null;
            if (cell?.sign === "up") {
                direction = "up";
                upCellCount += 1;
                if (cell?.isVisible === false) upHiddenCellCount += 1;
            } else if (cell?.sign === "down") {
                direction = "down";
                downCellCount += 1;
                if (cell?.isVisible === false) downHiddenCellCount += 1;
            }
            if (!direction) return;
            const horizon = finiteOrNull(cell?.horizon);
            const horizonKey = horizon === null ? "default" : horizon;
            const mass = horizonMass.get(horizonKey) || {up: 0, down: 0};
            mass[direction] += normalizedProbability;
            horizonMass.set(horizonKey, mass);
        });
        if (!upCellCount && !downCellCount) return null;
        const validHorizons = [...horizonMass.values()].filter((mass) => mass.up + mass.down > 0);
        const forecastHorizonCount = validHorizons.length;
        if (!forecastHorizonCount) return null;
        const upProbability = clamp(
            validHorizons.reduce((sum, mass) => sum + mass.up / (mass.up + mass.down), 0)
                / forecastHorizonCount,
            0,
            1,
        );
        return Object.freeze({
            upProbability,
            downProbability: 1 - upProbability,
            basis: "per-horizon-represented-mass",
            upCellCount,
            downCellCount,
            upHiddenCellCount,
            downHiddenCellCount,
            cellCount: upCellCount + downCellCount,
            hiddenCellCount: upHiddenCellCount + downHiddenCellCount,
            forecastHorizonCount,
        });
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

    const intersectPolylineAtX = (points, x) => {
        const queryX = Number(x);
        if (!Array.isArray(points) || !Number.isFinite(queryX)) return null;
        const finitePoints = [];
        points.forEach((point, fallbackIndex) => {
            const pointX = Number(point?.x);
            const pointY = Number(point?.y);
            if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return;
            const index = Number.isInteger(point?.index) ? point.index : fallbackIndex;
            finitePoints.push({index, x: pointX, y: pointY});
        });
        if (!finitePoints.length) return null;
        const firstPoint = finitePoints[0];
        const lastPoint = finitePoints[finitePoints.length - 1];
        if (queryX >= lastPoint.x) {
            return Object.freeze({
                index: lastPoint.index,
                x: lastPoint.x,
                y: lastPoint.y,
            });
        }
        if (queryX <= firstPoint.x) {
            return Object.freeze({
                index: firstPoint.index,
                x: firstPoint.x,
                y: firstPoint.y,
            });
        }
        let low = 0;
        let high = finitePoints.length - 1;
        while (low < high) {
            const midpoint = Math.floor((low + high) / 2);
            if (finitePoints[midpoint].x < queryX) low = midpoint + 1;
            else high = midpoint;
        }
        const rightPoint = finitePoints[low];
        const leftPoint = finitePoints[Math.max(0, low - 1)];
        if (rightPoint.x === queryX) {
            return Object.freeze({
                index: rightPoint.index,
                x: queryX,
                y: rightPoint.y,
            });
        }
        const span = rightPoint.x - leftPoint.x;
        const progress = span > 0 ? (queryX - leftPoint.x) / span : 0;
        const nearestPoint = Math.abs(leftPoint.x - queryX) <= Math.abs(rightPoint.x - queryX)
            ? leftPoint
            : rightPoint;
        return Object.freeze({
            index: nearestPoint.index,
            x: queryX,
            y: leftPoint.y + ((rightPoint.y - leftPoint.y) * progress),
        });
    };

    const isPriceFieldStrategy = (strategyId) => PRICE_FIELD_STRATEGY_IDS.includes(
        String(strategyId || ""),
    );

    const api = Object.freeze({
        BACKTEST_PROBABILITY_GRID_VERSION: "v0.28.0",
        DEFAULT_COLUMN_COUNT,
        MAX_ROWS_PER_SIDE,
        CELL_OPACITY_MAPPING,
        PRESENTATION_SCHEMA,
        PRESENTATION_SCHEMAS,
        PRICE_FIELD_STRATEGY_IDS,
        RENDERER_ID,
        isPriceFieldStrategy,
        buildProbabilityCells,
        computeInstantOpacityProfile,
        computeGridMinimumPlotHeight,
        computeMaximumGridHalfHeight,
        computeGridGeometry,
        computeAnchoredDetailGridPosition,
        intersectPolylineAtX,
        isPointNearCurve,
        multiStepNormalParameters,
        normalCdf,
        normalizePresentation,
        probabilityBetweenPrices,
        reducePinState,
        resolveDatasetStepPixels,
        summarizeProbabilityField,
        summarizeProbabilityRow,
    });

    globalScope.WORTHWARD_BACKTEST_PROBABILITY_GRID = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
