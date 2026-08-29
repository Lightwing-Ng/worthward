/* Bayesian Backtest probability-grid contracts. Code version: v0.4.0 */

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

test('accepts only the versioned Bayesian presentation schema', () => {
    const normalized = grid.normalizePresentation(presentation, {raw_dates: rawDates, length: rawDates.length});
    assert.equal(normalized.renderer, 'probability-grid-v1');
    assert.equal(normalized.rows_above, 6);
    assert.deepEqual(normalized.data_keys, rawDates);
    assert.deepEqual(normalized.predictive_mean, [0.001, null, -0.002]);
    assert.equal(grid.normalizePresentation({...presentation, schema: 'other/v1'}, rawDates, rawDates.length), null);
    assert.equal(grid.normalizePresentation({...presentation, predictive_scale: [0.02]}, rawDates, rawDates.length), null);
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

test('maps the overlay to exactly one quarter of the price plot', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 72, right: 872, top: 8, bottom: 168},
        anchorX: 300,
        anchorY: 84,
        rowsAbove: 6,
        rowsBelow: 6,
        widthFraction: 0.25,
    });
    assert.ok(geometry);
    assert.equal(geometry.width, 200);
    assert.equal(geometry.rowCount, 12);
    assert.equal(geometry.top + (geometry.height / 2), 84);
    assert.ok(geometry.cellSize > 0);
    assert.ok(geometry.columnCount > 1);
    const reconstructedWidth = (2 * geometry.padding)
        + (geometry.columnCount * geometry.cellSize)
        + ((geometry.columnCount - 1) * geometry.gap);
    assert.ok(Math.abs(reconstructedWidth - geometry.width) < 1e-9);
});

test('keeps the future field rightward without changing its width near the right plot edge', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 50, right: 650, top: 0, bottom: 180},
        anchorX: 620,
        anchorY: 90,
    });
    assert.equal(geometry.direction, 'right');
    assert.equal(geometry.left, 620);
    assert.equal(geometry.width, 150);
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

test('builds square probability cells with six green and six red rows', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 600, top: 0, bottom: 180},
        anchorX: 200,
        anchorY: 90,
    });
    const cells = grid.buildProbabilityCells({
        geometry,
        anchorPrice: 100,
        mean: 0.002,
        scale: 0.02,
        stepPixels: 17,
        valueForPixel: (pixel) => 109 - (pixel * 0.1),
    });
    assert.equal(cells.length, 12 * geometry.columnCount);
    assert.equal(cells.filter((cell) => cell.sign === 'up').length, 6 * geometry.columnCount);
    assert.equal(cells.filter((cell) => cell.sign === 'down').length, 6 * geometry.columnCount);
    assert.ok(cells.every((cell) => cell.size === geometry.cellSize));
    assert.ok(cells.every((cell) => cell.probability >= 0 && cell.probability <= 1));
    assert.ok(cells.every((cell) => cell.opacity === cell.probability));
    assert.ok(cells.every((cell) => cell.centerX > geometry.anchorX));
    assert.ok(cells.every((cell) => (
        Math.abs(cell.horizon - ((cell.centerX - geometry.anchorX) / 17)) < 1e-12
    )));
    assert.ok(cells.some((cell) => cell.horizon > 0 && !Number.isInteger(cell.horizon)));
    assert.ok(Math.max(...cells.map((cell) => cell.opacity)) < 1);
});

test('uses a positive fractional horizon without truncating it', () => {
    const halfStep = grid.probabilityBetweenPrices({
        anchorPrice: 100,
        lowerPrice: 100,
        upperPrice: 110,
        mean: 0,
        scale: 0.1,
        horizon: 0.5,
    });
    const fullStep = grid.probabilityBetweenPrices({
        anchorPrice: 100,
        lowerPrice: 100,
        upperPrice: 110,
        mean: 0,
        scale: 0.1,
        horizon: 1,
    });
    assert.ok(halfStep > fullStep);
});

test('keeps zero-probability cells fully invisible', () => {
    const geometry = grid.computeGridGeometry({
        chartArea: {left: 0, right: 400, top: 0, bottom: 160},
        anchorX: 100,
        anchorY: 80,
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
