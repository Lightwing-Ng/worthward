/* Code version: v1.1.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
require('../app/web/static/assets/js/backtest/detail-chart.js');
const {computeLayout} = globalThis.WORTHWARD_PRICE_FIELD_DETAIL_CHART;

for (const width of [230, 710]) {
    test(`detail chart preserves square cells, symmetric time, and shared price mapping at ${width}px`, () => {
        const history = [20, 120, 40, 50];
        const layout = computeLayout({width, height: 240, anchorPrice: 50, lowerPrice: 30,
            upperPrice: 70, rowsAbove: 10, rowsBelow: 10, columns: 20, history, horizon: 3});
        assert.equal(layout.anchorX, width / 2);
        assert.equal(layout.historyX(3), width / 2);
        assert.equal(layout.priceToY(50), 120);
        assert.equal(layout.cellWidth, layout.cellHeight);
        assert.equal(layout.columnGap, 2);
        assert.equal(layout.historyX(0), layout.historyLeft);
        assert.equal(layout.forecastRight - layout.anchorX, layout.anchorX - layout.historyLeft);
        assert.ok(layout.gridLeft >= layout.anchorX);
        assert.ok(layout.gridLeft + layout.gridWidth <= width);
        assert.ok(layout.gridTop >= 0 && layout.gridTop + layout.gridHeight <= 240);
        assert.ok(layout.cellWidth > 0 && layout.cellHeight > 0);
        assert.equal(layout.pitch, layout.cellWidth + layout.columnGap);
    });
}
test('one-sided forecasts and single historical origins remain anchored', () => {
    const layout = computeLayout({width: 300, height: 100, anchorPrice: 50, lowerPrice: 30,
        upperPrice: 50, rowsAbove: 0, rowsBelow: 10, columns: 20, history: [50], horizon: 20});
    assert.equal(layout.historyX(0), 150);
    assert.ok(layout.gridTop >= layout.anchorY);
});
test('unavailable dimensions and degenerate price bins fail closed', () => {
    assert.equal(computeLayout({width: 0, height: 100, rowsAbove: 10, rowsBelow: 10, columns: 20}), null);
    assert.equal(computeLayout({width: 300, height: 100, anchorPrice: 50, lowerPrice: 50,
        upperPrice: 50, rowsAbove: 10, rowsBelow: 10, columns: 20}), null);
});

test('short observed history retains empty earlier time and does not distort squares', () => {
    const layout = computeLayout({width: 400, height: 220, anchorPrice: 50, lowerPrice: 30,
        upperPrice: 70, rowsAbove: 10, rowsBelow: 10, columns: 20, history: [45, 50], horizon: 20});
    assert.ok(Math.abs(layout.anchorX - layout.historyX(0) - layout.pitch) < 1e-9);
    assert.equal(layout.cellWidth, layout.cellHeight);
    assert.ok(layout.historyX(0) > layout.historyLeft);
});
