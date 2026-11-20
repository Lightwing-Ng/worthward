/* Motion Core scheduler contract tests. Code version: v1.1.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../../app/web/static/assets/js/motion.js', import.meta.url), 'utf8');
const tokenSource = fs.readFileSync(new URL('../../../app/web/static/assets/css/foundation/tokens.css', import.meta.url), 'utf8');

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
        motion: windowRef.WorthwardMotion,
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
    const cssCurve = tokenSource.match(/--motion-spring-080:\s*(linear\([^;]+\));/)?.[1];
    assert.equal(harness.motion.easingTokens.spring, cssCurve);
    for (const preset of Object.values(harness.motion.springPresets)) {
        const ratio = preset.damping / (2 * Math.sqrt(preset.stiffness * preset.mass));
        assert.ok(Math.abs(ratio - 0.8) < 1e-12);
    }
});

test('underdamped springs honor the declared initial velocity for every preset', () => {
    const {motion} = createMotionHarness();
    const elapsedSeconds = 1e-7;
    for (const preset of Object.values(motion.springPresets)) {
        for (const initialVelocity of [0, -2, 3]) {
            const parameters = {...preset, initialVelocity};
            const progress = elapsedSeconds / (preset.duration / 1000);
            const observedVelocity = motion.easing.spring(progress, parameters) / elapsedSeconds;
            assert.ok(Math.abs(observedVelocity - initialVelocity) < 0.00005,
                `Expected initial velocity ${initialVelocity}, got ${observedVelocity}`);
        }
    }
});

test('all presets use the same 0.80 damping shape and physical peak overshoot', () => {
    const {motion} = createMotionHarness();
    const expectedPeak = 1 + Math.exp(-0.8 * Math.PI / Math.sqrt(1 - 0.8 * 0.8));
    for (const preset of Object.values(motion.springPresets)) {
        const decay = preset.damping / (2 * preset.mass);
        const oscillation = Math.sqrt(preset.stiffness / preset.mass - decay * decay);
        const peakProgress = (Math.PI / oscillation) / (preset.duration / 1000);
        assert.ok(peakProgress < 1);
        const actualPeak = motion.easing.spring(peakProgress, preset);
        assert.ok(Math.abs(actualPeak - expectedPeak) < 1e-9,
            `Spring peak was ${actualPeak}`);
        assert.ok(motion.easing.spring(peakProgress - 0.001, preset) < actualPeak);
        assert.ok(motion.easing.spring(peakProgress + 0.001, preset) < actualPeak);
    }
});

test('standard spring overshoots once, then settles at the exact endpoint', () => {
    const {motion} = createMotionHarness();
    const preset = motion.springPresets.standard;
    const samples = Array.from({length: 101}, (_, index) => motion.easing.spring(index / 100, preset));
    assert.ok(samples.slice(1, 50).every((value, index) => value > samples[index]));
    assert.ok(Math.max(...samples) > 1.01 && Math.max(...samples) < 1.02);
    assert.ok(samples[99] > 1 && samples[99] < 1.005);
    assert.equal(motion.easing.spring(1, preset), 1);
});

test('spring state carries signed release velocity while a bounded visual settles', () => {
    const {motion} = createMotionHarness();
    const preset = motion.springPresets.bouncy;
    const parameters = {...preset, from: 0, to: 0, velocity: -320};
    assert.equal(motion.springState(0, parameters).position, 0);
    assert.equal(motion.springState(0, parameters).velocity, -320);
    assert.ok(motion.springState(0.05, parameters).position < 0);
    assert.ok(Math.abs(motion.springState(0.62, parameters).position) < 1);
    assert.ok(motion.springState(0.05, {...parameters, velocity: 320}).position > 0);
});

test('velocity tracker rejects stale samples and caps extreme pointer speed', () => {
    const {motion} = createMotionHarness();
    const tracker = motion.createVelocityTracker();
    tracker.sample(0, 100);
    tracker.sample(12, 120);
    assert.equal(tracker.velocity(120), 600);
    assert.equal(tracker.velocity(220), 0);
    tracker.sample(80, 140);
    assert.equal(tracker.velocity(140), 2000);
    tracker.sample(180, 150);
    assert.equal(tracker.velocity(150), 2400);
    tracker.reset();
    assert.equal(tracker.velocity(150), 0);
});
