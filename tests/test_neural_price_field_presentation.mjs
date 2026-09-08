/* Direct probability-horizon presentation contracts. Code version: v1.0.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
require('../app/web/static/assets/js/backtest/distributions.js');
require('../app/web/static/assets/js/backtest/probability-grid.js');
const distributions = globalThis.WORTHWARD_PRICE_FIELD_DISTRIBUTIONS;
const grid = globalThis.WORTHWARD_BACKTEST_PROBABILITY_GRID;
const horizonMean = Array.from({length: 20}, (_, index) => 0.01 * (index + 1));
const horizonStd = Array.from({length: 20}, () => 0.02);
const model = {
    schema: 'patchtst-price-field/v1', renderer: 'probability-grid-v1', renderer_schema: 'probability-grid/v1',
    distribution_kind: 'direct-normal-horizon', multi_step_kind: 'direct-horizon', max_horizon: 20,
    predictive_mean: [0.01, null], predictive_scale: [0.02, null],
    horizon_predictive_mean: [horizonMean, Array(20).fill(null)],
    horizon_predictive_std: [horizonStd, Array(20).fill(null)],
    data_keys: ['2026-09-03', '2026-09-04'],
};

test('direct distributions use learned horizon moments without AR extrapolation', () => {
    const direct = distributions.createRegistry().resolve('direct-normal-horizon');
    assert.equal(direct, distributions.directGaussian);
    const probability = direct.probabilityAboveAnchor({horizon: 2, horizonMean, horizonStd});
    assert.ok(Math.abs(probability - distributions.normalCdf(1)) < 1e-12);
    assert.equal(direct.probabilityAboveAnchor({horizon: 21, horizonMean, horizonStd}), null);
    assert.equal(direct.probabilityAboveAnchor({horizon: 1.5, horizonMean, horizonStd}), null);
    assert.equal(direct.probabilityAboveAnchor({horizon: 1, horizonMean: [null], horizonStd: [0.2]}), null);
    assert.equal(direct.probabilityAboveAnchor({horizon: 1, horizonMean: [0.2], horizonStd: [-0.2]}), null);
});

test('direct probability bands reconcile to their own normal CDF', () => {
    const probability = distributions.directGaussian.probabilityBetweenPrices({
        anchorPrice: 100, lowerPrice: 100 * Math.exp(0.04 - 0.02),
        upperPrice: 100 * Math.exp(0.04 + 0.02), horizon: 4, horizonMean, horizonStd,
    });
    assert.ok(Math.abs(probability - (distributions.normalCdf(1) - distributions.normalCdf(-1))) < 1e-12);
});

test('direct presentations require complete aligned horizon arrays and matching first head', () => {
    const normalized = grid.normalizePresentation(model, model.data_keys);
    assert.deepEqual(normalized.horizon_predictive_mean, model.horizon_predictive_mean);
    assert.equal(grid.normalizePresentation({...model, max_horizon: 40}, model.data_keys), null);
    assert.equal(grid.normalizePresentation({...model, predictive_mean: [0.02, null]}, model.data_keys), null);
    assert.equal(grid.normalizePresentation({...model, horizon_predictive_std: [Array(19).fill(0.02), Array(20).fill(null)]}, model.data_keys), null);
    assert.equal(grid.normalizePresentation({...model, horizon_predictive_std: [Array(20).fill(-1), Array(20).fill(null)]}, model.data_keys), null);
});

test('zoomed overview preserves day spacing and omits untrained horizons', () => {
    const geometry = grid.computeGridGeometry({chartArea: {left: 0, right: 800, top: 0, bottom: 600},
        anchorX: 400, anchorY: 300, stepPixels: 1, limitRowsToChartArea: false});
    const cells = grid.buildProbabilityCells({geometry, distribution: distributions.directGaussian,
        anchorPrice: 100, mean: 0.01, scale: 0.02, horizonMean, horizonStd,
        maxHorizon: 20, stepPixels: 1, valueForPixel: (pixel) => 130 - pixel * 0.1});
    assert.ok(cells.length > 0);
    assert.ok(geometry.daysPerColumn > 1);
    assert.ok(cells.every((cell) => cell.horizon <= 20 && Number.isFinite(cell.probability)));
    assert.equal(Math.max(...cells.map((cell) => cell.column)) + 1, Math.floor(20 / geometry.daysPerColumn));
    const detail = grid.buildProbabilityCells({geometry: {...geometry, daysPerColumn: 1},
        distribution: distributions.directGaussian, anchorPrice: 100, mean: 0.01, scale: 0.02,
        horizonMean, horizonStd, maxHorizon: 20, stepPixels: 1, valueForPixel: (pixel) => 130 - pixel * 0.1});
    assert.equal(new Set(detail.map((cell) => cell.horizon)).size, 20);
});
