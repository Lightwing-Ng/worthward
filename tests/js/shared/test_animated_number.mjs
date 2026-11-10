/* AnimatedNumber spring invariants. Code version: v1.0.0 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ANIMATED_NUMBER_TUNING,
    ANIMATED_NUMBER_VERSION,
    advanceNumberSpring,
    getCyclicDigitTarget,
} from '../../../app/web/static/assets/js/animated-number.js';

test('the shared numeric spring exposes the requested physical and staggering constants', () => {
    assert.equal(ANIMATED_NUMBER_VERSION, 'v1.0.0');
    assert.equal(ANIMATED_NUMBER_TUNING.stiffness, 340);
    assert.equal(ANIMATED_NUMBER_TUNING.damping, 26);
    assert.equal(ANIMATED_NUMBER_TUNING.mass, 1);
    assert.equal(ANIMATED_NUMBER_TUNING.staggerMs, 16);
    assert.equal(ANIMATED_NUMBER_TUNING.signDurationMs, 200);
    assert.ok(ANIMATED_NUMBER_TUNING.reducedDurationMs <= 150);
    assert.ok(Object.isFrozen(ANIMATED_NUMBER_TUNING));
});

test('cyclic digits wrap in the global numeric direction across positive and negative cycles', () => {
    assert.equal(getCyclicDigitTarget(9, 0, 1), 10);
    assert.equal(getCyclicDigitTarget(0, 9, -1), -1);
    assert.equal(getCyclicDigitTarget(-1, 0, 1), 0);
    assert.equal(getCyclicDigitTarget(-10, 9, -1), -11);
    assert.equal(getCyclicDigitTarget(29.2, 2, 1), 32);
    assert.equal(getCyclicDigitTarget(20.8, 8, -1), 18);
});

test('digit targets retain a congruent resting position instead of adding unnecessary revolutions', () => {
    assert.equal(getCyclicDigitTarget(21, 1, 1), 21);
    assert.equal(getCyclicDigitTarget(21, 1, -1), 21);
    for (const position of [-80.3, -0.4, 4.7, 92.2]) {
        for (let digit = 0; digit < 10; digit += 1) {
            const up = getCyclicDigitTarget(position, digit, 1);
            const down = getCyclicDigitTarget(position, digit, -1);
            assert.ok(up >= position);
            assert.ok(down <= position);
            assert.equal(((up % 10) + 10) % 10, digit);
            assert.equal(((down % 10) + 10) % 10, digit);
            assert.ok(up - position < 10);
            assert.ok(position - down < 10);
        }
    }
});

test('zero and negative time steps preserve the exact current position and velocity', () => {
    const current = {position: 4.25, velocity: 8.5};
    assert.deepEqual(advanceNumberSpring(current.position, current.velocity, -8, 0), current);
    assert.deepEqual(advanceNumberSpring(current.position, current.velocity, -8, -1), current);
});

test('a delayed frame is clamped before physical integration', () => {
    assert.deepEqual(
        advanceNumberSpring(0, 3, 10, 30),
        advanceNumberSpring(0, 3, 10, ANIMATED_NUMBER_TUNING.maxDeltaSeconds),
    );
});

test('the underdamped spring converges with a bounded natural overshoot', () => {
    let state = {position: 0, velocity: 0};
    let peak = 0;
    for (let frame = 0; frame < 180; frame += 1) {
        state = advanceNumberSpring(state.position, state.velocity, 1, 1 / 60);
        peak = Math.max(peak, state.position);
    }
    assert.ok(peak > 1);
    assert.ok(peak < 1.1);
    assert.ok(Math.abs(state.position - 1) < 1e-9);
    assert.ok(Math.abs(state.velocity) < 1e-9);
});

test('retargeting starts from the current spring state without resetting momentum', () => {
    let state = {position: 0, velocity: 0};
    for (let frame = 0; frame < 5; frame += 1) {
        state = advanceNumberSpring(state.position, state.velocity, 8, 1 / 60);
    }
    assert.ok(state.position > 0 && state.position < 8);
    assert.ok(state.velocity > 0);
    assert.deepEqual(advanceNumberSpring(state.position, state.velocity, -3, 0), state);
    const retargeted = advanceNumberSpring(state.position, state.velocity, -3, 1 / 60);
    const reset = advanceNumberSpring(state.position, 0, -3, 1 / 60);
    assert.notEqual(retargeted.position, reset.position);
    assert.notEqual(retargeted.velocity, reset.velocity);
    for (let frame = 0; frame < 180; frame += 1) {
        state = advanceNumberSpring(state.position, state.velocity, -3, 1 / 60);
    }
    assert.ok(Math.abs(state.position + 3) < 1e-9);
});

for (const damping of [2 * Math.sqrt(340), 50, 80]) {
    test(`damping ${damping} remains finite and converges without overshoot`, () => {
        const tuning = {...ANIMATED_NUMBER_TUNING, damping};
        let state = {position: 0, velocity: 0};
        for (let frame = 0; frame < 600; frame += 1) {
            state = advanceNumberSpring(state.position, state.velocity, 1, 1 / 60, tuning);
            assert.ok(Number.isFinite(state.position) && Number.isFinite(state.velocity));
            assert.ok(state.position >= 0 && state.position <= 1 + 1e-12);
        }
        assert.ok(Math.abs(state.position - 1) < 1e-9);
        assert.ok(Math.abs(state.velocity) < 1e-9);
    });
}
