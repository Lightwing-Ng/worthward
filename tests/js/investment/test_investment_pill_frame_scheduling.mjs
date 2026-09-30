/* Pill-first scheduling of Investment view and range selections. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentRangeTransferRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/range-transfer.js';

// A controllable frame loop and timer queue, so the order of "pill frame first, work after"
// is asserted without a browser.
function installFakeClock(t, {hidden = false} = {}) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const frames = [];
    const timers = [];
    globalThis.window = {
        requestAnimationFrame(callback) {
            frames.push(callback);
            return frames.length;
        },
        setTimeout(callback, delay = 0) {
            timers.push({callback, delay});
            return timers.length;
        },
    };
    globalThis.document = {hidden};
    t.after(() => {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    });
    return {
        runFrame() {
            frames.splice(0).forEach((callback) => callback(0));
        },
        runTimers(maxDelay = 0) {
            const due = timers.filter((timer) => timer.delay <= maxDelay);
            due.forEach((timer) => timers.splice(timers.indexOf(timer), 1));
            due.forEach((timer) => timer.callback());
        },
    };
}

function createApi() {
    return createInvestmentRangeTransferRuntime({state: {}});
}

test('follow-up work waits for the frame that started the pill, then a timer turn', (t) => {
    const clock = installFakeClock(t);
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => calls.push('work'));

    assert.deepEqual(calls, [], 'the click itself never runs the work');
    clock.runFrame();
    assert.deepEqual(calls, [], 'the frame callback only queues the timer, so the frame renders first');
    clock.runTimers(0);
    assert.deepEqual(calls, ['work']);
});

test('a newer request under the same key replaces a pending one', (t) => {
    const clock = installFakeClock(t);
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => calls.push('first'));
    api.runAfterInvestmentPillFrame('view', () => calls.push('second'));
    clock.runFrame();
    clock.runTimers(0);

    assert.deepEqual(calls, ['second'], 'rapid selections apply only the last one');
});

test('requests under different keys do not replace each other', (t) => {
    const clock = installFakeClock(t);
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => calls.push('view'));
    api.runAfterInvestmentPillFrame('equity-range', () => calls.push('range'));
    clock.runFrame();
    clock.runTimers(0);

    assert.deepEqual(calls.sort(), ['range', 'view']);
});

test('cancelling reports whether a request was waiting and stops its work', (t) => {
    const clock = installFakeClock(t);
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => calls.push('work'));

    assert.equal(api.cancelInvestmentPillFrameWork('view'), true);
    assert.equal(api.cancelInvestmentPillFrameWork('view'), false, 'nothing is waiting any more');
    clock.runFrame();
    clock.runTimers(0);
    assert.deepEqual(calls, []);
});

test('cancelling a request that already ran reports nothing pending', (t) => {
    const clock = installFakeClock(t);
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => calls.push('work'));
    clock.runFrame();
    clock.runTimers(0);

    assert.deepEqual(calls, ['work']);
    assert.equal(api.cancelInvestmentPillFrameWork('view'), false);
});

test('work requested during another request run is not lost', (t) => {
    const clock = installFakeClock(t);
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => {
        calls.push('outer');
        // A direct view change cancels the (already running) request and may queue the next.
        assert.equal(api.cancelInvestmentPillFrameWork('view'), false);
        api.runAfterInvestmentPillFrame('view', () => calls.push('inner'));
    });
    clock.runFrame();
    clock.runTimers(0);
    clock.runFrame();
    clock.runTimers(0);

    assert.deepEqual(calls, ['outer', 'inner']);
});

test('a document that is not rendering runs the work at once without a frame loop', (t) => {
    const clock = installFakeClock(t, {hidden: true});
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => calls.push('work'));
    clock.runTimers(0);

    assert.deepEqual(calls, ['work']);
});

test('a stalled frame loop is covered by the long fallback, and the work runs once', (t) => {
    const clock = installFakeClock(t);
    const api = createApi();
    const calls = [];
    api.runAfterInvestmentPillFrame('view', () => calls.push('work'));

    clock.runTimers(0);
    assert.deepEqual(calls, [], 'the short timers are not due before the frame callback queues one');
    clock.runTimers(1000);
    assert.deepEqual(calls, ['work']);
    clock.runFrame();
    clock.runTimers(1000);
    assert.deepEqual(calls, ['work'], 'a late frame must not run the work a second time');
});
