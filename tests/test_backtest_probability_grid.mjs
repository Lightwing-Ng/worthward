/* Bayesian Backtest probability-grid contracts. Code version: v0.5.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'app/web/static/assets/js/backtest/probability-grid.js'));
const grid = globalThis.ANTIGRAVITY_BACKTEST_PROBABILITY_GRID;

const rawDates = ['2026-08-25', '2026-08-26', '2026-08-27'];
const presentation = {
    schema: 'bayesian-price-field/v1',
    renderer: 'probability-grid-v1',
    rows_above: 6,
    rows_below: 6,
    width_fraction: 0.25,
    data_keys: rawDates,
    predictive_mean: [0.001, null, -0.002],
    predictive_scale: [0.02, null, 0.03],
};

test('exports the discrete probability-field geometry contract version', () => {
    assert.equal(grid.BACKTEST_PROBABILITY_GRID_VERSION, 'v0.5.0');
});

test('accepts only the versioned Bayesian presentation schema', () => {
    const normalized = grid.normalizePresentation(presentation, {raw_dates: rawDates, length: rawDates.length});
    assert.equal(normalized.renderer, 'probability-grid-v1');
    assert.equal(normalized.rows_above, 6);
    assert.equal(normalized.rows_below, 6);
    assert.equal(normalized.columns, 36);
    assert.equal(normalized.gap_px, 3);
    assert.equal(normalized.padding_px, 8);
    assert.equal(normalized.min_cell_px, 4);
    assert.equal(normalized.cell_radius_px, 2);
    assert.equal(normalized.tooltip_radius_px, 10);
    assert.equal(normalized.tooltip_transparency_pct, 90);
    assert.equal(normalized.time_quantization, 'integer-trading-days');
    assert.deepEqual(normalized.data_keys, rawDates);
    assert.deepEqual(normalized.predictive_mean, [0.001, null, -0.002]);
    assert.equal(grid.normalizePresentation({...presentation, schema: 'other/v1'}, rawDates, rawDates.length), null);
    assert.equal(grid.normalizePresentation({...presentation, predictive_scale: [0.02]}, rawDates, rawDates.length), null);
});

test('normalizes every Bayesian field to the fixed six-up and six-down row contract', () => {
    const normalized = grid.normalizePresentation(
        {...presentation, rows_above: 2, rows_below: 11},
        {raw_dates: rawDates, length: rawDates.length},
    );
    assert.equal(normalized.rows_above, 6);
    assert.equal(normalized.rows_below, 6);
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

test('quantizes 36 columns below the preferred quarter width when complete day slots fit', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 72, right: 1672, top: 8, bottom: 208},
        anchorX: 300,
        anchorY: 108,
        widthFraction: 0.25,
        stepPixels: 2,
    });
    assert.ok(geometry);
    assert.equal(geometry.widthTarget, 400);
    assert.equal(geometry.width, 373);
    assert.equal(geometry.rowCount, 12);
    assert.equal(geometry.rowsAbove, 6);
    assert.equal(geometry.rowsBelow, 6);
    assert.equal(geometry.columnCount, 36);
    assert.equal(geometry.daysPerColumn, 5);
    assert.equal(geometry.slotWidth, 10);
    assert.equal(geometry.cellSize, 7);
    assert.equal(geometry.top + (geometry.height / 2), 108);
    assert.equal(geometry.exceedsPreferredWidth, false);
    const reconstructedWidth = (2 * geometry.padding)
        + (geometry.columnCount * geometry.cellSize)
        + ((geometry.columnCount - 1) * geometry.gap);
    assert.equal(reconstructedWidth, geometry.width);
    assert.ok(geometry.width <= geometry.widthTarget);
    assert.ok(geometry.width + (geometry.columnCount * geometry.stepPixels) > geometry.widthTarget);
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

test('prioritizes complete day slots and the four-pixel cell minimum over quarter width', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 600, top: 0, bottom: 180},
        anchorX: 300,
        anchorY: 90,
        stepPixels: 2,
    });
    assert.equal(geometry.widthTarget, 150);
    assert.equal(geometry.columnCount, 36);
    assert.equal(geometry.daysPerColumn, 4);
    assert.equal(geometry.slotWidth, 8);
    assert.equal(geometry.cellSize, 5);
    assert.equal(geometry.exceedsPreferredWidth, true);
    assert.ok(geometry.width > geometry.widthTarget);
    assert.ok(geometry.cellSize >= 4);
    assert.equal(geometry.slotWidth / geometry.stepPixels, geometry.daysPerColumn);
});

test('allows one complete trading day when its slot preserves the cell-radius minimum', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 1200, top: 0, bottom: 180},
        anchorX: 300,
        anchorY: 90,
        stepPixels: 7,
    });
    assert.equal(geometry.daysPerColumn, 1);
    assert.equal(geometry.slotWidth, 7);
    assert.equal(geometry.cellSize, 4);
});

test('reserves the maximum symmetric half-height around an extreme price anchor', () => {
    assert.equal(grid.computeMaximumGridHalfHeight({
        rowsAbove: 6,
        rowsBelow: 6,
        gapPx: 3,
        paddingPx: 8,
        maxCellPx: 10,
    }), 84.5);
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

test('builds square probability cells with six green and six red rows', () => {
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
    });
    assert.equal(cells.length, 12 * 36);
    assert.equal(cells.filter((cell) => cell.sign === 'up').length, 6 * 36);
    assert.equal(cells.filter((cell) => cell.sign === 'down').length, 6 * 36);
    assert.ok(cells.every((cell) => cell.size === geometry.cellSize));
    assert.ok(cells.every((cell) => cell.size >= 4));
    assert.ok(cells.every((cell) => cell.probability >= 0 && cell.probability <= 1));
    assert.ok(cells.every((cell) => cell.opacity === cell.probability));
    assert.ok(cells.every((cell) => cell.centerX > geometry.anchorX));
    assert.ok(cells.every((cell) => (
        cell.horizon === (cell.column + 1) * geometry.daysPerColumn
    )));
    assert.ok(cells.every((cell) => Number.isInteger(cell.horizon)));
    assert.ok(cells.every((cell) => Number.isInteger(cell.daysPerColumn)));
    assert.ok(cells.every((cell) => cell.slotWidth === geometry.slotWidth));
    assert.equal(cells[0].x, geometry.anchorX + geometry.padding);
    assert.equal(cells[1].x - cells[0].x, geometry.slotWidth);
    assert.ok(Math.max(...cells.map((cell) => cell.opacity)) < 1);
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
