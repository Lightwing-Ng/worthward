/* Shared pixel-space date-axis layout contracts. Code version: v1.0.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
require(path.join(root, 'app/web/static/assets/js/chart-axis-utils.js'));
const { layoutDateAxisTicks } = globalThis.WORTHWARD_CHART_AXIS;

// One point per day across a plot from x=60 to x=600, labels 40px wide.
function layout({ count = 120, plotLeft = 60, plotRight = 600, width = 40, ...options } = {}) {
    return layoutDateAxisTicks({
        count,
        getPixel: (index) => plotLeft + ((plotRight - plotLeft) * index) / Math.max(1, count - 1),
        measureWidth: () => width,
        boundsLeft: 0,
        boundsRight: plotRight + 20,
        ...options,
    });
}

function assertNoCollision(ticks, minGap = 48) {
    for (let index = 1; index < ticks.length; index += 1) {
        assert.ok(
            ticks[index - 1].right + minGap <= ticks[index].left,
            `ticks ${ticks[index - 1].index} and ${ticks[index].index} collide`,
        );
    }
}

test('edge labels are flush and interior labels are centered', () => {
    const ticks = layout();
    assert.equal(ticks[0].index, 0);
    assert.equal(ticks[0].align, 'left');
    assert.equal(ticks.at(-1).index, 119);
    assert.equal(ticks.at(-1).align, 'right');
    ticks.slice(1, -1).forEach((tick) => assert.equal(tick.align, 'center'));
});

test('a wide plot is filled with as many evenly spaced labels as fit', () => {
    const ticks = layout();
    assert.ok(ticks.length >= 5, `expected a filled axis, got ${ticks.length}`);
    assertNoCollision(ticks);
    const centers = ticks.map((tick) => tick.x);
    const steps = centers.slice(1).map((x, index) => x - centers[index]);
    const [minStep, maxStep] = [Math.min(...steps), Math.max(...steps)];
    assert.ok(maxStep - minStep <= (540 / 119) + 1e-9, 'interior spacing is even up to one point');
});

test('a narrow plot never lets labels collide', () => {
    for (const plotRight of [140, 180, 260, 340]) {
        const ticks = layout({ plotRight });
        assertNoCollision(ticks);
        assert.equal(ticks[0].align, 'left');
    }
});

test('two points that cannot both fit keep only the first label', () => {
    const ticks = layout({ count: 2, plotLeft: 60, plotRight: 100 });
    assert.deepEqual(ticks.map((tick) => tick.index), [0]);
});

test('points sharing one date label are deduplicated to the earliest point', () => {
    const ticks = layout({ count: 40, getKey: (index) => Math.floor(index / 10) });
    const keys = ticks.map((tick) => Math.floor(tick.index / 10));
    assert.equal(new Set(keys).size, keys.length);
    ticks.forEach((tick) => assert.equal(tick.index % 10, 0));
});

test('optional special dates are kept and even labels fill around them', () => {
    const special = 77;
    const ticks = layout({ specialIndexes: [special], includeSpecialIndexes: true });
    assert.ok(ticks.some((tick) => tick.index === special));
    assertNoCollision(ticks);
    const withoutFlag = layout({ specialIndexes: [special] });
    assert.deepEqual(withoutFlag, layout(), 'special dates are ignored unless enabled');
});

test('a special date colliding with an edge label is dropped', () => {
    const ticks = layout({ specialIndexes: [1], includeSpecialIndexes: true });
    assert.ok(!ticks.some((tick) => tick.index === 1));
    assertNoCollision(ticks);
});
