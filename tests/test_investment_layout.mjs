/* Tests for shared workspace split-layout calculations. Code version: v1.2.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_LAYOUT_MODULE_VERSION,
    resolveInvestmentOverviewHeight,
    resolveInvestmentTrackRange,
} from '../app/web/static/assets/js/investment/layout.js';

test('module exposes a semantic cache-busting version', () => {
    assert.match(INVESTMENT_LAYOUT_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('track range reserves both desired minimums when space permits', () => {
    assert.deepEqual(resolveInvestmentTrackRange({
        availableHeight: 700,
        baselineMinimum: 132,
        desiredOverviewMinimum: 300,
        desiredHistoryMinimum: 220,
    }), {
        minimum: 300,
        layoutMinimum: 300,
        maximum: 480,
        historyMinimum: 220,
    });
});

test('track range proportionally compresses extra minimum height in constrained viewports', () => {
    const range = resolveInvestmentTrackRange({
        availableHeight: 400,
        baselineMinimum: 132,
        desiredOverviewMinimum: 300,
        desiredHistoryMinimum: 220,
    });
    assert.equal(Math.round(range.minimum + range.historyMinimum), 400);
    assert.ok(range.minimum >= 132);
    assert.ok(range.historyMinimum >= 132);
});

test('preferOverviewMinimum keeps the overview budget when history also wants extra space', () => {
    const constrained = {
        availableHeight: 650,
        baselineMinimum: 132,
        desiredOverviewMinimum: 441,
        desiredHistoryMinimum: 306,
    };
    const compressed = resolveInvestmentTrackRange(constrained);
    assert.equal(Math.round(compressed.minimum), 379);
    assert.equal(Math.round(compressed.layoutMinimum), 379);
    const range = resolveInvestmentTrackRange({
        ...constrained,
        preferOverviewMinimum: true,
    });
    assert.equal(range.minimum, 441);
    assert.equal(Math.round(range.layoutMinimum), 379);
    assert.equal(range.historyMinimum, 132);
    assert.equal(range.maximum, 518);
});

test('overview height clamps ratios to the measured range', () => {
    const range = {minimum: 250, maximum: 500};
    assert.equal(resolveInvestmentOverviewHeight(800, 0.2, range), 250);
    assert.equal(resolveInvestmentOverviewHeight(800, 0.9, range), 500);
    assert.equal(resolveInvestmentOverviewHeight(800, 0.5, range), 400);
});
