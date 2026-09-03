/* Bayesian Backtest probability-grid contracts. Code version: v0.25.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'app/web/static/assets/js/backtest/probability-grid.js'));
const grid = globalThis.WORTHWARD_BACKTEST_PROBABILITY_GRID;

const rawDates = ['2026-08-25', '2026-08-26', '2026-08-27'];
const presentation = {
    schema: 'bayesian-price-field/v1',
    renderer: 'probability-grid-v1',
    rows_above: 10,
    rows_below: 10,
    columns: 20,
    width_fraction: 0.25,
    gap_px: 2,
    padding_px: 8,
    min_cell_px: 4,
    cell_radius_px: 2,
    tooltip_radius_px: 10,
    tooltip_transparency_pct: 50,
    cell_opacity_mapping: 'instant-contrast-power-v1',
    cell_opacity_exponent: 1.6,
    cell_opacity_tail_ratio: 0.02,
    cell_display_threshold_pct: 5,
    time_quantization: 'integer-trading-days',
    multi_step_kind: 'causal-ar1-return-state',
    data_keys: rawDates,
    predictive_mean: [0.001, null, -0.002],
    predictive_scale: [0.02, null, 0.03],
    return_autoregression: [0.2, null, -0.1],
    return_long_run_mean: [0.0005, null, 0.0002],
    return_innovation_scale: [0.018, null, 0.025],
};

test('exports the discrete probability-field geometry contract version', () => {
    assert.equal(grid.BACKTEST_PROBABILITY_GRID_VERSION, 'v0.25.1');
    assert.equal(grid.CELL_OPACITY_MAPPING, 'instant-contrast-power-v1');
});

test('accepts only the versioned Bayesian presentation schema', () => {
    const normalized = grid.normalizePresentation(presentation, {raw_dates: rawDates, length: rawDates.length});
    assert.equal(normalized.renderer, 'probability-grid-v1');
    assert.equal(normalized.rows_above, 10);
    assert.equal(normalized.rows_below, 10);
    assert.equal(normalized.columns, 20);
    assert.equal(normalized.gap_px, 2);
    assert.equal(normalized.padding_px, 8);
    assert.equal(normalized.min_cell_px, 4);
    assert.equal('cell_radius_px' in normalized, false);
    assert.equal('tooltip_radius_px' in normalized, false);
    assert.equal('tooltip_transparency_pct' in normalized, false);
    assert.equal(normalized.cell_opacity_mapping, 'instant-contrast-power-v1');
    assert.equal(normalized.cell_opacity_exponent, 1.6);
    assert.equal(normalized.cell_opacity_tail_ratio, 0.02);
    assert.equal(normalized.cell_display_threshold_pct, 5);
    assert.equal(normalized.time_quantization, 'integer-trading-days');
    assert.deepEqual(normalized.data_keys, rawDates);
    assert.deepEqual(normalized.predictive_mean, [0.001, null, -0.002]);
    assert.deepEqual(normalized.return_autoregression, [0.2, null, -0.1]);
    assert.deepEqual(normalized.return_long_run_mean, [0.0005, null, 0.0002]);
    assert.deepEqual(normalized.return_innovation_scale, [0.018, null, 0.025]);
    assert.equal(grid.normalizePresentation({...presentation, schema: 'other/v1'}, rawDates, rawDates.length), null);
    assert.equal(grid.normalizePresentation({...presentation, predictive_scale: [0.02]}, rawDates, rawDates.length), null);
    assert.equal(grid.normalizePresentation({...presentation, return_autoregression: [0.2]}, rawDates, rawDates.length), null);
});

test('preserves bounded strategy-owned symmetric geometry while fixing the 20-column horizon', () => {
    const normalized = grid.normalizePresentation(
        {
            ...presentation,
            rows_above: 9,
            rows_below: 9,
            columns: 18,
            gap_px: 2.5,
            padding_px: 6,
            min_cell_px: 3,
            cell_radius_px: 1.5,
            cell_opacity_exponent: 2.4,
            cell_opacity_tail_ratio: 0.05,
            width_fraction: 0.3,
        },
        {raw_dates: rawDates, length: rawDates.length},
    );
    assert.equal(normalized.rows_above, 9);
    assert.equal(normalized.rows_below, 9);
    assert.equal(normalized.columns, 20);
    assert.equal(normalized.gap_px, 2);
    assert.equal(normalized.padding_px, 6);
    assert.equal(normalized.min_cell_px, 4);
    assert.equal('cell_radius_px' in normalized, false);
    assert.equal(normalized.cell_opacity_mapping, 'instant-contrast-power-v1');
    assert.equal(normalized.cell_opacity_exponent, 2.4);
    assert.equal(normalized.cell_opacity_tail_ratio, 0.05);
    assert.equal(normalized.width_fraction, 0.3);

    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 120,
        columnCount: normalized.columns,
        gapPx: 2.5,
        minCellPx: normalized.min_cell_px,
        paddingPx: normalized.padding_px,
        rowsAbove: normalized.rows_above,
        rowsBelow: normalized.rows_below,
        stepPixels: 4,
        widthFraction: normalized.width_fraction,
    });
    assert.equal(geometry.columnCount, 20);
    assert.equal(geometry.rowsAbove, 7);
    assert.equal(geometry.rowsBelow, 7);
    assert.equal(geometry.rowCount, 14);
    assert.equal(geometry.gap, 2.5);
    assert.equal(geometry.padding, 6);
    assert.equal(geometry.widthTarget, 360);
    const horizontalGuideY = geometry.top
        + geometry.gridPaddingTop
        + (geometry.rowsAbove * geometry.cellSize)
        + ((geometry.rowsAbove - 0.5) * geometry.gap);
    assert.equal(horizontalGuideY, geometry.anchorY);
});

test('bounds untrusted strategy-owned geometry and rejects asymmetric rows', () => {
    const normalized = grid.normalizePresentation(
        {
            ...presentation,
            rows_above: 0,
            rows_below: 100,
            columns: 0,
            gap_px: -1,
            padding_px: 100,
            min_cell_px: 0,
            cell_radius_px: -1,
            tooltip_radius_px: -1,
            tooltip_transparency_pct: 101,
            cell_opacity_mapping: 'untrusted-mapping',
            cell_opacity_exponent: 100,
            cell_opacity_tail_ratio: 1,
            cell_display_threshold_pct: 75,
            width_fraction: 1,
        },
        {raw_dates: rawDates, length: rawDates.length},
    );
    assert.equal(normalized.rows_above, 10);
    assert.equal(normalized.rows_below, 10);
    assert.equal(normalized.columns, 20);
    assert.equal(normalized.gap_px, 2);
    assert.equal(normalized.padding_px, 64);
    assert.equal(normalized.min_cell_px, 4);
    assert.equal('cell_radius_px' in normalized, false);
    assert.equal('tooltip_radius_px' in normalized, false);
    assert.equal('tooltip_transparency_pct' in normalized, false);
    assert.equal(normalized.cell_opacity_mapping, 'instant-contrast-power-v1');
    assert.equal(normalized.cell_opacity_exponent, 4);
    assert.equal(normalized.cell_opacity_tail_ratio, 0.25);
    assert.equal(normalized.cell_display_threshold_pct, 50);
    assert.equal(normalized.width_fraction, 0.5);

    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 800, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 120,
        rowsAbove: 2,
        rowsBelow: 11,
        stepPixels: 4,
    });
    assert.equal(geometry.rowsAbove, 10);
    assert.equal(geometry.rowsBelow, 10);
    assert.equal(geometry.rowCount, 20);
    const horizontalGuideY = geometry.top
        + geometry.gridPaddingTop
        + (geometry.rowsAbove * geometry.cellSize)
        + ((geometry.rowsAbove - 0.5) * geometry.gap);
    assert.equal(horizontalGuideY, geometry.anchorY);
    assert.equal(
        grid.computeMaximumGridHalfHeight({rowsAbove: 2, rowsBelow: 11}),
        grid.computeMaximumGridHalfHeight({rowsAbove: 10, rowsBelow: 10}),
    );
});

test('fails closed when Bayesian prediction keys do not exactly match the chart time axis', () => {
    assert.equal(grid.normalizePresentation(presentation), null);
    assert.equal(grid.normalizePresentation(presentation, [...rawDates].reverse(), rawDates.length), null);
    assert.equal(grid.normalizePresentation(
        {...presentation, data_keys: [...rawDates, '2026-08-28']},
        rawDates,
        rawDates.length,
    ), null);
    assert.equal(grid.normalizePresentation(presentation, rawDates, rawDates.length - 1), null);
});

test('keeps legacy presentations length-aligned when they omit explicit data keys', () => {
    const {data_keys: ignoredDataKeys, ...legacyPresentation} = presentation;
    assert.equal(ignoredDataKeys, rawDates);
    assert.ok(grid.normalizePresentation(legacyPresentation, rawDates.length));
    assert.equal(grid.normalizePresentation(legacyPresentation, rawDates.length - 1), null);
});

test('quantizes 20 columns below the preferred quarter width when complete day slots fit', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 72, right: 1672, top: 8, bottom: 208},
        anchorX: 300,
        anchorY: 108,
        widthFraction: 0.25,
        stepPixels: 2,
    });
    assert.ok(geometry);
    assert.equal(geometry.widthTarget, 400);
    assert.equal(geometry.width, 368);
    assert.equal(geometry.rowCount, 10);
    assert.equal(geometry.rowsAbove, 5);
    assert.equal(geometry.rowsBelow, 5);
    assert.equal(geometry.columnCount, 20);
    assert.equal(geometry.daysPerColumn, 9);
    assert.equal(geometry.slotWidth, 18);
    assert.equal(geometry.cellSize, 16);
    assert.equal(geometry.top + (geometry.height / 2), 108);
    assert.equal(geometry.exceedsPreferredWidth, false);
    const reconstructedWidth = geometry.gridPaddingInlineStart + geometry.padding
        + (geometry.columnCount * geometry.cellSize)
        + ((geometry.columnCount - 1) * geometry.gap);
    assert.equal(reconstructedWidth, geometry.width);
    assert.ok(geometry.width <= geometry.widthTarget);
    assert.ok(geometry.width + (geometry.columnCount * geometry.stepPixels) > geometry.widthTarget);
});

test('carries the three-month reference cell size across longer ranges', () => {
    const reference = grid.computeGridGeometry({
        chartArea: {left: 72, right: 361, top: 8, bottom: 208},
        anchorX: 200,
        anchorY: 108,
        stepPixels: 4.515625,
    });
    const longerRange = grid.computeGridGeometry({
        chartArea: {left: 72, right: 361, top: 8, bottom: 208},
        anchorX: 200,
        anchorY: 108,
        stepPixels: 2.312,
        cellSizeTargetPx: reference.cellSize,
    });
    assert.equal(reference.cellSize, 7.03125);
    assert.equal(longerRange.cellSizeTarget, reference.cellSize);
    assert.ok(longerRange.cellSize >= reference.cellSize);
    assert.ok(longerRange.cellSize - reference.cellSize < longerRange.stepPixels);
    assert.equal(longerRange.daysPerColumn, 4);
    assert.ok(Math.abs(longerRange.cellSize - 7.248) < 1e-9);
    assert.equal(longerRange.slotWidth / longerRange.stepPixels, longerRange.daysPerColumn);
    assert.equal(longerRange.cellSize + longerRange.gap, longerRange.slotWidth);
});

test('uses the half-plot cap and each chart boundary to floor the ten-row ceiling', () => {
    const centered = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 120,
        stepPixels: 6,
    });
    assert.equal(centered.availableRowsPerSide, 9);
    assert.equal(centered.rowsAbove, 9);
    assert.equal(centered.rowsBelow, 9);
    assert.equal(centered.gap, 2);
    assert.ok(centered.top >= 0);
    assert.ok(centered.top + centered.height <= 240);

    const completeRows = (distance) => Math.floor(
        ((distance - centered.padding + (centered.gap / 2)) / centered.slotWidth) + 1e-9,
    );
    assert.equal(centered.availableRowsAbove, completeRows(120));
    assert.equal(centered.availableRowsBelow, completeRows(120));

    const nearTop = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 20,
        stepPixels: 6,
    });
    assert.equal(nearTop.availableRowsPerSide, 9);
    assert.equal(nearTop.rowsAbove, 1);
    assert.equal(nearTop.rowsBelow, 9);
    assert.ok(nearTop.top >= 0);
    assert.ok(nearTop.top + nearTop.height <= 240);
    assert.equal(nearTop.availableRowsAbove, completeRows(20));
    assert.equal(nearTop.availableRowsBelow, completeRows(220));

    const nearBottom = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 220,
        stepPixels: 6,
    });
    assert.equal(nearBottom.rowsAbove, 9);
    assert.equal(nearBottom.rowsBelow, 1);
    assert.equal(nearBottom.availableRowsAbove, completeRows(220));
    assert.equal(nearBottom.availableRowsBelow, completeRows(20));

    const shortPlot = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 80},
        anchorX: 200,
        anchorY: 40,
        stepPixels: 6,
    });
    assert.equal(shortPlot.availableRowsPerSide, 2);
    assert.equal(shortPlot.rowsAbove, 2);
    assert.equal(shortPlot.rowsBelow, 2);
});

test('can preserve the complete row lattice for an independent detail surface', () => {
    const detailGeometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 20,
        rowsAbove: 10,
        rowsBelow: 10,
        stepPixels: 6,
        limitRowsToChartArea: false,
    });
    assert.equal(detailGeometry.rowsAbove, 10);
    assert.equal(detailGeometry.rowsBelow, 10);
    assert.equal(detailGeometry.rowCount, 20);
    assert.equal(detailGeometry.availableRowsAbove, 1);
    assert.equal(detailGeometry.availableRowsBelow, 17);
    assert.ok(detailGeometry.top < 0);
    const horizontalGuideY = detailGeometry.top
        + detailGeometry.gridPaddingTop
        + (detailGeometry.rowsAbove * detailGeometry.cellSize)
        + ((detailGeometry.rowsAbove - 0.5) * detailGeometry.gap);
    assert.equal(horizontalGuideY, detailGeometry.anchorY);
});

test('derives the resizer plot minimum from the same quantized horizontal lattice', () => {
    const probe = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 600},
        anchorX: 200,
        anchorY: 300,
        stepPixels: 6,
    });
    const minimum = grid.computeGridMinimumPlotHeight({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 600},
        widthFraction: 0.25,
        gapPx: 2,
        paddingPx: 8,
        minCellPx: 4,
        rowsAbove: 10,
        rowsBelow: 10,
        stepPixels: 6,
    });
    assert.ok(minimum);
    assert.equal(minimum.cellSize, probe.cellSize);
    assert.equal(minimum.columnCount, 20);
    assert.equal(minimum.daysPerColumn, probe.daysPerColumn);
    assert.equal(minimum.slotWidth, probe.slotWidth);
    assert.equal(minimum.chartAreaMinimumHeight, 254);
    assert.equal(
        minimum.chartAreaMinimumHeight,
        2 * grid.computeMaximumGridHalfHeight({
            rowsAbove: 10,
            rowsBelow: 10,
            gapPx: probe.gap,
            paddingPx: probe.padding,
            maxCellPx: probe.cellSize,
        }),
    );

    const fitting = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: minimum.chartAreaMinimumHeight},
        anchorX: 200,
        anchorY: minimum.chartAreaMinimumHeight / 2,
        stepPixels: 6,
    });
    assert.equal(fitting.rowsAbove, 10);
    assert.equal(fitting.rowsBelow, 10);
    assert.equal(fitting.cellSize, minimum.cellSize);
});

test('preserves an integer bar lattice for daily and generic minute-scale spacing', () => {
    const scenarios = [
        {name: 'daily', stepPixels: 6},
        {name: 'minute-scale', stepPixels: 0.5},
    ];
    scenarios.forEach(({name, stepPixels}) => {
        const geometry = grid.computeGridGeometry({
            chartArea: {left: 0, right: 1200, top: 0, bottom: 600},
            anchorX: 200,
            anchorY: 300,
            stepPixels,
        });
        assert.equal(geometry.columnCount, 20, name);
        assert.ok(Number.isInteger(geometry.daysPerColumn), name);
        assert.ok(geometry.daysPerColumn >= 1, name);
        assert.equal(geometry.slotWidth / geometry.stepPixels, geometry.daysPerColumn, name);
        assert.equal(geometry.cellSize + geometry.gap, geometry.slotWidth, name);
        assert.ok(geometry.cellSize >= 4, name);
    });
});

test('keeps a stable rightward width across hover anchors', () => {
    const points = [{x: 50}, {x: 52}, {x: 54}, {x: 56}, {x: 58}];
    const firstStep = grid.resolveDatasetStepPixels(points, 1);
    const secondStep = grid.resolveDatasetStepPixels(points, 4);
    const firstGeometry = grid.computeGridGeometry({
        chartArea: {left: 50, right: 650, top: 0, bottom: 180},
        anchorX: 200,
        anchorY: 90,
        stepPixels: firstStep,
    });
    const secondGeometry = grid.computeGridGeometry({
        chartArea: {left: 50, right: 650, top: 0, bottom: 180},
        anchorX: 620,
        anchorY: 90,
        stepPixels: secondStep,
    });
    assert.equal(firstStep, secondStep);
    assert.equal(firstGeometry.width, secondGeometry.width);
    assert.equal(firstGeometry.direction, 'right');
    assert.equal(secondGeometry.left, 620);
    assert.equal(secondGeometry.anchorX, 620);
});

test('prioritizes complete day slots, the four-pixel cell minimum, and the requested gap', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 600, top: 0, bottom: 180},
        anchorX: 300,
        anchorY: 90,
        stepPixels: 2,
    });
    assert.equal(geometry.widthTarget, 150);
    assert.equal(geometry.columnCount, 20);
    assert.equal(geometry.daysPerColumn, 3);
    assert.equal(geometry.slotWidth, 6);
    assert.equal(geometry.gap, 2);
    assert.equal(geometry.gridPaddingInlineStart, 2);
    assert.equal(geometry.cellSize, 4);
    assert.equal(geometry.exceedsPreferredWidth, false);
    assert.ok(geometry.width <= geometry.widthTarget);
    assert.ok(geometry.cellSize >= 4);
    assert.equal(geometry.slotWidth / geometry.stepPixels, geometry.daysPerColumn);
});

test('keeps all 20 columns while preserving an unrealizable requested gap', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 600, top: 0, bottom: 180},
        anchorX: 300,
        anchorY: 90,
        columnCount: 18,
        gapPx: 3,
        minCellPx: 4,
        stepPixels: 3,
    });
    assert.equal(geometry.columnCount, 20);
    assert.equal(geometry.daysPerColumn, 3);
    assert.equal(geometry.slotWidth, 9);
    assert.equal(geometry.requestedGap, 3);
    assert.equal(geometry.gap, 3);
    assert.equal(geometry.cellSize, 6);
    assert.equal(geometry.width, 188);
    assert.equal(geometry.slotWidth / geometry.stepPixels, geometry.daysPerColumn);
});

test('allows one complete trading day when its slot preserves the cell minimum', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 180},
        anchorX: 300,
        anchorY: 90,
        widthFraction: 0.1,
        stepPixels: 7,
    });
    assert.equal(geometry.daysPerColumn, 1);
    assert.equal(geometry.slotWidth, 7);
    assert.equal(geometry.cellSize, 5);
});

test('reserves the maximum symmetric half-height around an extreme price anchor', () => {
    assert.equal(grid.computeMaximumGridHalfHeight({
        rowsAbove: 6,
        rowsBelow: 6,
        gapPx: 3,
        paddingPx: 8,
        maxCellPx: 10,
    }), 84.5);
    assert.equal(grid.computeMaximumGridHalfHeight({
        rowsAbove: 2,
        rowsBelow: 2,
        gapPx: 2,
        paddingPx: 6,
        maxCellPx: 8,
    }), 25);
    assert.equal(grid.computeMaximumGridHalfHeight({
        rowsAbove: 10,
        rowsBelow: 10,
        gapPx: 1,
        paddingPx: 8,
        maxCellPx: 128,
    }), 1297.5);
});

test('derives one trading-step width from actual Chart.js dataset points', () => {
    const points = [{x: 72}, {x: 84.5}, {x: 97}, {x: 109.5}];
    assert.equal(grid.resolveDatasetStepPixels(points, 1), 12.5);
    assert.equal(grid.resolveDatasetStepPixels(points, 3), 12.5);
    assert.equal(grid.resolveDatasetStepPixels([{x: 72}], 0), null);
});

test('uses one robust dataset-wide step instead of an anchor-local hover step', () => {
    const points = [{x: 10}, {x: 22}, {x: 34.2}, {x: 46}];
    assert.equal(grid.resolveDatasetStepPixels(points, 0), 12);
    assert.equal(grid.resolveDatasetStepPixels(points, 2), 12);
    assert.equal(grid.resolveDatasetStepPixels(points, 3), 12);
});

test('maps each hover field through its own nonlinear winner and invisible tail', () => {
    const first = grid.computeInstantOpacityProfile(
        [0, 0.005, 0.01, 0.1, 0.5],
        {exponent: 1.6, tailRatio: 0.02},
    );
    const second = grid.computeInstantOpacityProfile(
        [0, 0.0025, 0.005, 0.05, 0.25],
        {exponent: 1.6, tailRatio: 0.02},
    );
    assert.deepEqual(
        first.map((entry) => entry.opacity),
        second.map((entry) => entry.opacity),
    );
    assert.deepEqual(first.slice(0, 3).map((entry) => entry.opacity), [0, 0, 0]);
    assert.equal(first.at(-1).displayIntensity, 1);
    assert.equal(first.at(-1).opacity, 1);
    assert.ok(first[3].displayIntensity > 0 && first[3].displayIntensity < 1);
    assert.ok(first[3].opacity > 0 && first[3].opacity < first[3].displayIntensity);
    assert.ok(Math.abs(
        first[3].opacity - Math.pow(first[3].displayIntensity, 1.6)
    ) <= 1e-12);
    assert.deepEqual(
        grid.computeInstantOpacityProfile([0, 0, 0]).map((entry) => entry.opacity),
        [0, 0, 0],
    );
    assert.deepEqual(
        grid.computeInstantOpacityProfile([0.2, 0.2]).map((entry) => entry.opacity),
        [1, 1],
    );
    assert.deepEqual(
        grid.computeInstantOpacityProfile([Number.NaN, -1, Number.POSITIVE_INFINITY])
            .map((entry) => entry.opacity),
        [0, 0, 0],
    );
});

test('keeps the instantaneous contrast curve scale-invariant for extreme probabilities', () => {
    const tiny = grid.computeInstantOpacityProfile(
        [1e-20, 3e-20, 5e-20],
        {exponent: 1.6, tailRatio: 0.02},
    );
    const scaled = grid.computeInstantOpacityProfile(
        [1e-10, 3e-10, 5e-10],
        {exponent: 1.6, tailRatio: 0.02},
    );
    tiny.forEach((entry, index) => {
        assert.ok(Math.abs(entry.opacity - scaled[index].opacity) <= 1e-12);
        assert.ok(Math.abs(entry.displayIntensity - scaled[index].displayIntensity) <= 1e-12);
    });
    assert.equal(tiny[0].opacity, 0);
    assert.ok(tiny[1].opacity > 0 && tiny[1].opacity < tiny[1].displayIntensity);
    assert.equal(tiny[2].opacity, 1);

    const mixed = grid.computeInstantOpacityProfile(
        [Number.NaN, -1, Number.POSITIVE_INFINITY, 0.25, 0.25],
    );
    assert.deepEqual(mixed.map((entry) => entry.opacity), [0, 0, 0, 1, 1]);
});

test('builds square probability cells with ten green and ten red nonlinear rows', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 600, top: 0, bottom: 180},
        anchorX: 200,
        anchorY: 90,
        stepPixels: 2,
    });
    const cells = grid.buildProbabilityCells({
        geometry,
        anchorPrice: 100,
        mean: 0.002,
        scale: 0.02,
        stepPixels: 2,
        valueForPixel: (pixel) => 109 - (pixel * 0.1),
        opacityExponent: 1.6,
        opacityTailRatio: 0.02,
    });
    assert.equal(cells.length, 20 * 20);
    assert.equal(cells.filter((cell) => cell.sign === 'up').length, 10 * 20);
    assert.equal(cells.filter((cell) => cell.sign === 'down').length, 10 * 20);
    assert.ok(cells.every((cell) => cell.size === geometry.cellSize));
    assert.ok(cells.every((cell) => cell.size >= 4));
    assert.ok(cells.every((cell) => cell.probability >= 0 && cell.probability <= 1));
    assert.ok(cells.every((cell) => cell.displayIntensity >= 0 && cell.displayIntensity <= 1));
    assert.ok(cells.every((cell) => cell.opacity >= 0 && cell.opacity <= 1));
    assert.ok(cells.every((cell) => cell.centerX > geometry.anchorX));
    assert.ok(cells.every((cell) => (
        cell.horizon === (cell.column + 1) * geometry.daysPerColumn
    )));
    assert.ok(cells.every((cell) => Number.isInteger(cell.horizon)));
    assert.ok(cells.every((cell) => Number.isInteger(cell.daysPerColumn)));
    assert.ok(cells.every((cell) => cell.slotWidth === geometry.slotWidth));
    assert.equal(cells[0].x, geometry.anchorX + geometry.gridPaddingInlineStart);
    assert.equal(geometry.gridPaddingInlineStart, 2);
    assert.equal(cells[1].x - cells[0].x, geometry.slotWidth);
    assert.equal(Math.max(...cells.map((cell) => cell.opacity)), 1);
    assert.equal(Math.min(...cells.map((cell) => cell.opacity)), 0);
    assert.ok(cells.some((cell) => (
        cell.displayIntensity > 0
        && cell.displayIntensity < 1
        && Math.abs(cell.opacity - cell.displayIntensity) > 1e-6
    )));
    const winnerProbability = Math.max(...cells.map((cell) => cell.probability));
    assert.ok(cells.filter((cell) => cell.probability === winnerProbability)
        .every((cell) => cell.opacity === 1));
});

test('marks cells below the absolute display threshold without changing their geometry', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 600, top: 0, bottom: 180},
        anchorX: 200,
        anchorY: 90,
        stepPixels: 2,
    });
    const build = (cellDisplayThresholdPct) => grid.buildProbabilityCells({
        geometry,
        anchorPrice: 100,
        mean: 0.002,
        scale: 0.02,
        stepPixels: 2,
        valueForPixel: (pixel) => 109 - (pixel * 0.1),
        cellDisplayThresholdPct,
    });
    const allCells = build(0);
    const exactThresholdPct = allCells[0].probability * 100;
    const exactThresholdCells = build(exactThresholdPct);
    const hiddenCells = build(5);
    assert.ok(allCells.every((cell) => cell.isVisible === true));
    assert.equal(exactThresholdCells[0].isVisible, true);
    assert.ok(exactThresholdCells.some((cell) => cell.isVisible === false));
    assert.ok(hiddenCells.some((cell) => cell.isVisible === false));
    assert.ok(hiddenCells.every((cell, index) => (
        cell.x === allCells[index].x
        && cell.y === allCells[index].y
        && cell.lowerPrice === allCells[index].lowerPrice
        && cell.upperPrice === allCells[index].upperPrice
    )));
});

test('summarizes every probability in a detail row, including threshold-hidden cells', () => {
    const summary = grid.summarizeProbabilityRow([
        {row: 4, lowerPrice: 49.6, upperPrice: 50.2, probability: 0.12, isVisible: true},
        {row: 4, lowerPrice: 49.6, upperPrice: 50.2, probability: 0.025, isVisible: false},
        {row: 4, lowerPrice: 49.6, upperPrice: 50.2, probability: 0.003, isVisible: false},
        {row: 3, lowerPrice: 50.2, upperPrice: 50.8, probability: 0.9, isVisible: true},
    ], 4);
    assert.equal(summary.row, 4);
    assert.equal(summary.lowerPrice, 49.6);
    assert.equal(summary.upperPrice, 50.2);
    assert.ok(Math.abs(summary.cumulativeProbability - 0.148) < 1e-12);
    assert.equal(summary.cellCount, 3);
    assert.equal(summary.hiddenCellCount, 2);
    assert.equal(grid.summarizeProbabilityRow([], 4), null);
    assert.equal(grid.summarizeProbabilityRow([{row: 4, probability: 0.2}], 3), null);
});

test('summarizes up and down probability mass across hidden and visible field cells', () => {
    const summary = grid.summarizeProbabilityField([
        {sign: 'up', horizon: 1, probability: 0.12, isVisible: true},
        {sign: 'up', horizon: 1, probability: 0.025, isVisible: false},
        {sign: 'down', horizon: 1, probability: 0.7, isVisible: true},
        {sign: 'down', horizon: 1, probability: 0.003, isVisible: false},
        {sign: 'other', horizon: 1, probability: 0.9, isVisible: true},
    ]);
    assert.ok(Math.abs(summary.upProbability - 0.145) < 1e-12);
    assert.ok(Math.abs(summary.downProbability - 0.703) < 1e-12);
    assert.equal(summary.upCellCount, 2);
    assert.equal(summary.downCellCount, 2);
    assert.equal(summary.upHiddenCellCount, 1);
    assert.equal(summary.downHiddenCellCount, 1);
    assert.equal(summary.cellCount, 4);
    assert.equal(summary.hiddenCellCount, 2);
    assert.equal(summary.forecastHorizonCount, 1);
    assert.equal(grid.summarizeProbabilityField([], 4), null);
});

test('averages directional probability mass across independent forecast horizons', () => {
    const summary = grid.summarizeProbabilityField([
        {sign: 'up', horizon: 1, probability: 0.7},
        {sign: 'down', horizon: 1, probability: 0.2},
        {sign: 'up', horizon: 2, probability: 0.5},
        {sign: 'down', horizon: 2, probability: 0.4},
    ]);
    assert.ok(Math.abs(summary.upProbability - 0.6) < 1e-12);
    assert.ok(Math.abs(summary.downProbability - 0.3) < 1e-12);
    assert.ok(summary.upProbability <= 1);
    assert.ok(summary.downProbability <= 1);
    assert.equal(summary.forecastHorizonCount, 2);
});

test('maps every cell to an exact price interval around the horizontal guide', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 120,
        stepPixels: 6,
    });
    const valueForPixel = (pixel) => 200 - (pixel * 0.75);
    const cells = grid.buildProbabilityCells({
        geometry,
        anchorPrice: valueForPixel(geometry.anchorY),
        mean: 0,
        scale: 0.02,
        stepPixels: geometry.stepPixels,
        valueForPixel,
    });
    assert.ok(cells.length > 0);
    assert.ok(cells.every((cell) => {
        const firstValue = valueForPixel(cell.y);
        const secondValue = valueForPixel(cell.yBottom);
        return cell.yBottom - cell.y === geometry.cellSize
            && cell.lowerPrice === Math.min(firstValue, secondValue)
            && cell.upperPrice === Math.max(firstValue, secondValue)
            && cell.upperPrice > cell.lowerPrice;
    }));
    const firstColumn = cells.filter((cell) => cell.column === 0);
    const upLast = firstColumn.find((cell) => cell.row === geometry.rowsAbove - 1);
    const downFirst = firstColumn.find((cell) => cell.row === geometry.rowsAbove);
    assert.ok(upLast && downFirst);
    assert.equal(downFirst.y - upLast.yBottom, geometry.gap);
    assert.equal((upLast.yBottom + downFirst.y) / 2, geometry.anchorY);
});

test('anchors an asymmetric detail grid at the horizontal guide', () => {
    const position = grid.computeAnchoredDetailGridPosition({
        viewportHeight: 240,
        rowsAbove: 9,
        rowsBelow: 3,
        cellSize: 8,
        gapPx: 2,
        paddingPx: 8,
    });
    assert.ok(position);
    assert.equal(position.anchorY, 120);
    assert.equal(position.top + position.aboveExtent, position.anchorY);
    assert.equal(position.top + position.height, position.anchorY + position.belowExtent);
    assert.equal(position.top + position.height, 157);
});

test('keeps one-sided detail cells outside the horizontal guide', () => {
    const belowOnly = grid.computeAnchoredDetailGridPosition({
        viewportHeight: 240,
        rowsAbove: 0,
        rowsBelow: 3,
        cellSize: 8,
        gapPx: 2,
        paddingPx: 8,
    });
    assert.ok(belowOnly);
    assert.equal(belowOnly.top + 8, 121);
    assert.equal(belowOnly.top + belowOnly.height, 157);
    assert.equal(belowOnly.aboveExtent, 7);
    assert.equal(belowOnly.belowExtent, 37);

    const aboveOnly = grid.computeAnchoredDetailGridPosition({
        viewportHeight: 240,
        rowsAbove: 3,
        rowsBelow: 0,
        cellSize: 8,
        gapPx: 2,
        paddingPx: 8,
    });
    assert.ok(aboveOnly);
    assert.equal(aboveOnly.top + 8 + 28, 119);
    assert.equal(aboveOnly.top + aboveOnly.height, 127);
    assert.equal(aboveOnly.aboveExtent, 37);
    assert.equal(aboveOnly.belowExtent, 7);
});

test('keeps one-sided hover cells outside the horizontal guide', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 20,
        stepPixels: 6,
    });
    assert.ok(geometry);
    assert.equal(geometry.rowsAbove, 1);
    assert.ok(geometry.rowsBelow > 0);

    const belowOnly = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 4,
        stepPixels: 6,
    });
    assert.ok(belowOnly);
    assert.equal(belowOnly.rowsAbove, 0);
    assert.ok(belowOnly.rowsBelow > 0);
    const belowFirstCellTop = belowOnly.top + belowOnly.gridPaddingTop;
    assert.equal(belowFirstCellTop - belowOnly.anchorY, belowOnly.gap / 2);

    const aboveOnly = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 236,
        stepPixels: 6,
    });
    assert.ok(aboveOnly);
    assert.ok(aboveOnly.rowsAbove > 0);
    assert.equal(aboveOnly.rowsBelow, 0);
    const aboveLastCellBottom = aboveOnly.top + aboveOnly.gridPaddingTop
        + (aboveOnly.rowsAbove * aboveOnly.cellSize)
        + ((aboveOnly.rowsAbove - 1) * aboveOnly.gap);
    assert.equal(aboveOnly.anchorY - aboveLastCellBottom, aboveOnly.gap / 2);
});

test('assigns green only to cells whose full price interval is at or above the anchor', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 240},
        anchorX: 200,
        anchorY: 220,
        stepPixels: 6,
    });
    const cells = grid.buildProbabilityCells({
        geometry,
        anchorPrice: 100,
        mean: 0,
        scale: 0.02,
        stepPixels: geometry.stepPixels,
        valueForPixel: (pixel) => 200 - (pixel * 0.5),
    });
    assert.ok(cells.length > 0);
    assert.ok(cells.filter((cell) => cell.sign === 'up')
        .every((cell) => cell.lowerPrice >= 100));
    assert.ok(cells.filter((cell) => cell.sign === 'down')
        .every((cell) => cell.lowerPrice < 100));
});

test('evaluates probability mass at complete one-day and two-day horizons', () => {
    const oneDay = grid.probabilityBetweenPrices({
        anchorPrice: 100,
        lowerPrice: 100,
        upperPrice: 110,
        mean: 0,
        scale: 0.1,
        horizon: 1,
    });
    const twoDays = grid.probabilityBetweenPrices({
        anchorPrice: 100,
        lowerPrice: 100,
        upperPrice: 110,
        mean: 0,
        scale: 0.1,
        horizon: 2,
    });
    assert.ok(oneDay > twoDays);
});

test('evolves multi-step moments through mean reversion instead of frozen diffusion', () => {
    const forecast = grid.multiStepNormalParameters({
        mean: 0.02,
        scale: 0.01,
        horizon: 4,
        autoregression: 0.5,
        longRunMean: 0,
        innovationScale: 0.01,
    });
    assert.ok(forecast);
    assert.ok(Math.abs(forecast.mean - 0.0375) < 1e-12);
    assert.ok(forecast.scale > 0.01);
    assert.ok(forecast.mean < 0.08);
});

test('keeps zero-probability cells fully invisible', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 400, top: 0, bottom: 160},
        anchorX: 100,
        anchorY: 80,
        stepPixels: 10,
    });
    const cells = grid.buildProbabilityCells({
        geometry,
        anchorPrice: 100,
        mean: 0,
        scale: 0,
        stepPixels: 10,
        valueForPixel: () => 100,
    });
    assert.ok(cells.every((cell) => cell.probability === 0));
    assert.ok(cells.every((cell) => cell.opacity === 0));
});

test('tracks, pins, and clears one immutable hover state', () => {
    let state = grid.reducePinState(null, {type: 'track', index: 4});
    assert.deepEqual(state, {mode: 'tracking', activeIndex: 4});
    state = grid.reducePinState(state, {type: 'pin', index: 4});
    assert.deepEqual(state, {mode: 'pinned', activeIndex: 4});
    assert.equal(grid.reducePinState(state, {type: 'track', index: 8}), state);
    state = grid.reducePinState(state, {type: 'clear'});
    assert.deepEqual(state, {mode: 'tracking', activeIndex: null});
});

test('requires a click to land near the actual price curve before pinning', () => {
    assert.equal(grid.isPointNearCurve(102, 100, 14), true);
    assert.equal(grid.isPointNearCurve(116, 100, 14), false);
});

test('intersects a price polyline at the cursor x, including interrupted gaps', () => {
    const points = [
        {index: 0, x: 10, y: 40},
        {index: 1, x: 20, y: 20},
        {index: 2, x: Number.NaN, y: 10},
        {index: 3, x: 50, y: 80},
        {index: 4, x: 70, y: 60},
    ];
    assert.deepEqual(grid.intersectPolylineAtX(points, 10), {index: 0, x: 10, y: 40});
    assert.deepEqual(grid.intersectPolylineAtX(points, 15), {index: 0, x: 15, y: 30});
    assert.deepEqual(grid.intersectPolylineAtX(points, 20), {index: 1, x: 20, y: 20});
    const interrupted = grid.intersectPolylineAtX(points, 35);
    assert.equal(interrupted.index, 1);
    assert.equal(interrupted.x, 35);
    assert.equal(interrupted.y, 50);
    assert.equal(grid.intersectPolylineAtX(points, 70)?.index, 4);
    assert.deepEqual(grid.intersectPolylineAtX(points, 70.01), {index: 4, x: 70, y: 60});
    assert.deepEqual(grid.intersectPolylineAtX(points, 8), {index: 0, x: 10, y: 40});
});
