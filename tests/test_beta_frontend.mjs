/* Code version: v0.1.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {shockImpact} from '../app/web/static/assets/js/beta.js';

test('shock combines unlevered exposure with flat residual cash', () => {
    const result = shockImpact(-20, 50);
    assert.equal(result.change, -10);
    assert.ok(Math.abs(result.recovery - 100 / 9) < 1e-10);
    assert.deepEqual(shockImpact(-100, 0), {change: -0, recovery: 0});
});

test('a total loss has no finite recovery without new capital', () => {
    assert.deepEqual(shockImpact(-100, 100), {change: -100, recovery: null});
    assert.deepEqual(shockImpact(20, 50), {change: 10, recovery: 0});
});

test('invalid, leveraged, and below-total-loss assumptions fail explicitly', () => {
    for (const [shock, exposure] of [[NaN, 50], [-101, 100], [101, 10], [-20, -1], [-20, 101], [-20, Infinity]]) {
        assert.throws(() => shockImpact(shock, exposure));
    }
});
