/* Motion Core scheduler contract tests. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/web/static/assets/js/motion.js', import.meta.url), 'utf8');

function createMotionHarness({reduced = false} = {}) {
    const pendingFrames = new Map();
    let nextFrameId = 1;
    const windowRef = {
        matchMedia: () => ({matches: reduced}),
        requestAnimationFrame(callback) {
            const frameId = nextFrameId++;
            pendingFrames.set(frameId, callback);
            return frameId;
        },
        cancelAnimationFrame(frameId) {
            pendingFrames.delete(frameId);
        },
    };
    const context = {
        window: windowRef,
        Element: class Element {},
        getComputedStyle: () => ({transform: 'none'}),
    };
    vm.runInNewContext(source, context);
    return {
        motion: windowRef.AntigravityMotion,
        flush(now) {
            const callbacks = [...pendingFrames.values()];
            pendingFrames.clear();
            callbacks.forEach((callback) => callback(now));
        },
        get pendingFrameCount() {
            return pendingFrames.size;
        },
    };
}

test('Motion Core batches frame tasks and keeps reads before writes', () => {
    const harness = createMotionHarness();
    const events = [];
    harness.motion.scheduler.readWrite(
        'geometry',
        () => {
            events.push('read');
            return {width: 120};
        },
        (measurement) => events.push(`write:${measurement.width}`),
    );
    harness.motion.scheduler.frame('first', () => {
        events.push('frame:first');
        return false;
    });
    harness.motion.scheduler.frame('second', () => {
        events.push('frame:second');
        return false;
    });

    assert.equal(harness.pendingFrameCount, 1);
    harness.flush(16);
    assert.deepEqual(events, ['read', 'write:120', 'frame:first', 'frame:second']);
    assert.equal(harness.motion.scheduler.activeCount, 0);
});

test('Motion Core cancels keyed work and reduced motion settles on the first frame', () => {
    const harness = createMotionHarness({reduced: true});
    const progress = [];
    let completeCount = 0;
    harness.motion.scheduler.animate({
        key: 'replaceable',
        duration: 1_000,
        update: (_eased, value) => progress.push(value),
        complete: () => { completeCount += 1; },
    });
    harness.motion.scheduler.animate({
        key: 'replaceable',
        duration: 1_000,
        update: (_eased, value) => progress.push(value),
        complete: () => { completeCount += 1; },
    });
    harness.flush(16);

    assert.deepEqual(progress, [1]);
    assert.equal(completeCount, 1);
    assert.equal(harness.motion.scheduler.activeCount, 0);

    const cancel = harness.motion.scheduler.frame('cancel-me', () => true);
    cancel();
    assert.equal(harness.motion.scheduler.activeCount, 0);
});

test('Motion Core exposes shared spring parameters with stable endpoints', () => {
    const harness = createMotionHarness();
    const spring = harness.motion.easing.spring;
    assert.equal(spring(0), 0);
    assert.equal(spring(1), 1);
    assert.deepEqual(Object.keys(harness.motion.springPresets).sort(), ['bouncy', 'emphasized', 'standard']);
    assert.ok(Number.isFinite(spring(0.5)));
});
