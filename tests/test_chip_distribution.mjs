/* Tests for chip distribution calculations. Code version: v0.2.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(root, 'app/web/static/assets/js/chip-distribution.js'));
const calculator = globalThis.ANTIGRAVITY_CHIP_DISTRIBUTION;

const sampleRows = [
    {t: '2026-08-20', o: 98, h: 104, l: 96, c: 102, v: 1_000},
    {t: '2026-08-21', o: 102, h: 110, l: 100, c: 108, v: 2_000},
    {t: '2026-08-24', o: 108, h: 114, l: 106, c: 112, v: 3_000},
];

test('distributes every candle volume across its price range and conserves volume', () => {
    const distribution = calculator.calculateChipDistribution(sampleRows, {binCount: 100});

    assert.equal(distribution.source, 'ohlcv-estimate');
    assert.equal(distribution.estimated, true);
    assert.equal(distribution.binCount, 100);
    assert.equal(distribution.bins.length, 100);
    assert.ok(Math.abs(distribution.totalWeight - 6_000) < 1e-8);
    assert.ok(distribution.bins.filter((bin) => bin.weight > 0).length > sampleRows.length);
    assert.ok(distribution.bins.some((bin) => bin.low < 112 && bin.high < 112 && bin.weight > 0));
});

test('normalizes the longest bin to one and exposes the same POC', () => {
    const distribution = calculator.calculateChipDistribution(sampleRows);
    const maxBin = distribution.bins.reduce((best, bin) => bin.weight > best.weight ? bin : best);

    assert.equal(maxBin.index, distribution.pocIndex);
    assert.equal(maxBin.price, distribution.pocPrice);
    assert.equal(maxBin.normalizedWidth, 1);
    assert.ok(distribution.bins.every((bin) => bin.normalizedWidth >= 0 && bin.normalizedWidth <= 1));
});

test('calculates weighted cost, profit ratio, and central cost ranges separately', () => {
    const distribution = calculator.calculateChipDistribution(sampleRows);
    const statistics = calculator.calculateChipStatistics(distribution, 108);

    assert.equal(statistics.pocPrice, distribution.pocPrice);
    assert.ok(statistics.weightedAverageCost > distribution.minPrice);
    assert.ok(statistics.weightedAverageCost < distribution.maxPrice);
    assert.ok(statistics.profitRatio > 0 && statistics.profitRatio < 1);
    assert.ok(statistics.costRange70[0] < statistics.costRange70[1]);
    assert.ok(statistics.costRange90[0] <= statistics.costRange70[0]);
    assert.ok(statistics.costRange90[1] >= statistics.costRange70[1]);
    assert.equal(calculator.calculateChipStatistics(distribution, null).profitRatio, null);
});

test('preserves Longbridge Buy / Neutral / Sell weights in each price bin', () => {
	const distribution = calculator.calculatePriceLevelDistribution([
		{price: 100, buy: 100, neutral: 200, sell: 300},
		{price: 101, buy: 50, neutral: 25, sell: 25},
    ], {binCount: 80});

    assert.equal(distribution.source, 'longbridge-trade-stats');
    assert.equal(distribution.estimated, false);
	assert.equal(distribution.binCount, 80);
	assert.equal(distribution.totalWeight, 700);
	assert.equal(distribution.maxWeight, 600);
	assert.equal(distribution.bins.filter((bin) => bin.weight > 0).length, 2);
	assert.deepEqual(distribution.categoryTotals, {buy: 150, neutral: 225, sell: 325});
	const poc = distribution.bins[distribution.pocIndex];
	assert.equal(poc.buyWeight, 100);
	assert.equal(poc.neutralWeight, 200);
	assert.equal(poc.sellWeight, 300);
	assert.equal(poc.normalizedBuyWidth, 100 / 600);
	assert.equal(poc.normalizedNeutralWidth, 200 / 600);
	assert.equal(poc.normalizedSellWidth, 0.5);
});

test('uses the neutral category for OHLCV estimates without fabricating trade direction', () => {
	const distribution = calculator.calculateChipDistribution(sampleRows);

	assert.equal(distribution.categoryTotals.buy, 0);
	assert.equal(distribution.categoryTotals.sell, 0);
	assert.equal(distribution.categoryTotals.neutral, distribution.totalWeight);
	assert.ok(distribution.bins.every((bin) => (
		bin.buyWeight === 0
		&& bin.sellWeight === 0
		&& bin.neutralWeight === bin.weight
	)));
});

test('rejects unusable rows, clamps bin counts, and supports flat-price candles', () => {
    assert.equal(calculator.calculateChipDistribution([]), null);
    assert.equal(calculator.calculatePriceLevelDistribution([{price: 0, buy: 1}]), null);

    const distribution = calculator.calculateChipDistribution([
        {o: 50, h: 50, l: 50, c: 50, v: 500},
        {o: 50, h: 51, l: 49, c: 50, v: 0},
        {o: 50, h: 51, l: 49, c: 50, v: 500, synthetic: true},
    ], {binCount: 10});

    assert.equal(distribution.binCount, 80);
    assert.ok(distribution.maxPrice > distribution.minPrice);
    assert.equal(distribution.totalWeight, 500);
    assert.equal(distribution.bins.filter((bin) => bin.weight > 0).length, 1);
    assert.equal(calculator.calculateChipStatistics(null, 50), null);
});
