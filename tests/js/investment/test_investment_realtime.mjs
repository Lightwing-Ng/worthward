/* Tests for Investment realtime polling and value transitions. Code version: v1.3.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_REALTIME_MODULE_VERSION,
    alignInvestmentLiveSegmentChars,
    buildInvestmentLiveSegmentPairs,
    parseInvestmentLiveDisplaySegments,
    resolveInvestmentLiveNumberDirection,
    createInvestmentRealtimeQuotePoller,
    createInvestmentLiveValueAnimator,
} from '../../../app/web/static/assets/js/investment/realtime.js';

test('module exposes a semantic cache-busting version', () => {
    assert.match(INVESTMENT_REALTIME_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('numeric direction ignores invalid and immaterial changes', () => {
    assert.equal(resolveInvestmentLiveNumberDirection(undefined, 10), 'flat');
    assert.equal(resolveInvestmentLiveNumberDirection(10, 10 + 1e-10), 'flat');
    assert.equal(resolveInvestmentLiveNumberDirection(10, 11), 'rise');
    assert.equal(resolveInvestmentLiveNumberDirection(10, 9), 'fall');
});

test('structured displays retain numeric typography segments', () => {
    assert.deepEqual(parseInvestmentLiveDisplaySegments('-1,939.03'), {
        isStructured: true,
        prefix: ['-'],
        integer: ['1', ',', '9', '3', '9'],
        dot: ['.'],
        fraction: ['0', '3'],
        suffix: [],
    });
    assert.deepEqual(parseInvestmentLiveDisplaySegments('32.80%')?.suffix, ['%']);
    assert.equal(parseInvestmentLiveDisplaySegments('-'), null);
});

test('right alignment preserves place value when digit counts change', () => {
    assert.deepEqual(
        alignInvestmentLiveSegmentChars(['9', '9'], ['1', '0', '0'], 'right'),
        [
            {previousChar: '', nextChar: '1'},
            {previousChar: '9', nextChar: '0'},
            {previousChar: '9', nextChar: '0'},
        ],
    );
});

test('live segment pairs align integer digits from the right and decimals from the left', () => {
    const pairs = buildInvestmentLiveSegmentPairs('99.90', '100.05');
    assert.deepEqual(
        pairs.map(({previousChar, nextChar, partClassName}) => ({
            previousChar,
            nextChar,
            partClassName,
        })),
        [
            {previousChar: '', nextChar: '1', partClassName: 'workspace-metric-value-major'},
            {previousChar: '9', nextChar: '0', partClassName: 'workspace-metric-value-major'},
            {previousChar: '9', nextChar: '0', partClassName: 'workspace-metric-value-major'},
            {previousChar: '.', nextChar: '.', partClassName: 'workspace-metric-value-minor'},
            {previousChar: '9', nextChar: '0', partClassName: 'workspace-metric-value-minor'},
            {previousChar: '0', nextChar: '5', partClassName: 'workspace-metric-value-minor'},
        ],
    );
});

test('unstructured labels use a deterministic right-aligned fallback', () => {
    const pairs = buildInvestmentLiveSegmentPairs('N/A', '54');
    assert.deepEqual(
        pairs.map(({previousChar, nextChar}) => [previousChar, nextChar]),
        [['N', ''], ['/', '5'], ['A', '4']],
    );
});

test('poller uses active and idle cadences without overlapping requests', async () => {
    const scheduled = [];
    const applied = [];
    let shouldRun = false;
    const poller = createInvestmentRealtimeQuotePoller({
        pollDelayMs: 60_000,
        idleDelayMs: 90_000,
        hasData: () => true,
        getTickers: () => ['META'],
        shouldRun: () => shouldRun,
        requestQuotes: async () => [{ticker: 'META', price: 700}],
        applyQuotes: (quotes) => applied.push(...quotes),
        setTimeoutFn: (callback, delay) => {
            scheduled.push({callback, delay});
            return scheduled.length;
        },
        clearTimeoutFn: () => {},
    });
    poller.schedule();
    assert.equal(scheduled.at(-1).delay, 90_000);
    shouldRun = true;
    await poller.poll();
    assert.deepEqual(applied, [{ticker: 'META', price: 700}]);
    assert.equal(scheduled.at(-1).delay, 60_000);
});

test('poller awaits refreshed session state before requesting quotes', async () => {
    let releaseSession;
    let sessionReady = false;
    let requestCount = 0;
    const sessionRefresh = new Promise((resolve) => {
        releaseSession = () => {
            sessionReady = true;
            resolve();
        };
    });
    const poller = createInvestmentRealtimeQuotePoller({
        hasData: () => true,
        getTickers: () => ['META'],
        shouldRun: () => sessionReady,
        refreshSession: () => sessionRefresh,
        requestQuotes: async () => {
            requestCount += 1;
            return [{ticker: 'META', price: 700}];
        },
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
    });

    const pending = poller.poll();
    await Promise.resolve();
    assert.equal(requestCount, 0);
    releaseSession();
    await pending;
    assert.equal(requestCount, 1);
});

test('stopping the poller aborts an in-flight request', async () => {
    let capturedSignal = null;
    let releaseRequest;
    const request = new Promise((resolve) => {
        releaseRequest = resolve;
    });
    const poller = createInvestmentRealtimeQuotePoller({
        hasData: () => true,
        getTickers: () => ['META'],
        shouldRun: () => true,
        requestQuotes: async (_tickers, {signal}) => {
            capturedSignal = signal;
            return request;
        },
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => {},
    });
    const pending = poller.poll();
    for (let attempt = 0; attempt < 5 && !capturedSignal; attempt += 1) {
        await Promise.resolve();
    }
    assert.notEqual(capturedSignal, null);
    poller.stop();
    assert.equal(capturedSignal.aborted, true);
    releaseRequest([]);
    await pending;
});


test('the real live updater removes unavailable numeric attributes and preserves a verified zero', () => {
    class TestElement {
        dataset = {investmentLiveDisplay: '7.00', investmentLiveNumber: '7'};
        textContent = '7.00';
        classList = {contains: () => false, remove: () => {}};
        closest(selector) { return selector === '#investment_holdings_panel' ? this : null; }
        replaceChildren() { this.textContent = ''; }
    }
    const updater = createInvestmentLiveValueAnimator({
        HTMLElementClass: TestElement,
        windowRef: {matchMedia: () => ({matches: true})},
        documentRef: {},
    });
    for (const value of [null, undefined, '', '   ', Number.NaN, Infinity]) {
        const node = new TestElement();
        updater.updateInvestmentLiveValueNode(node, 'Partial · total unavailable', value);
        assert.equal(node.dataset.investmentLiveDisplay, 'Partial · total unavailable');
        assert.equal(Object.hasOwn(node.dataset, 'investmentLiveNumber'), false);
        assert.equal(resolveInvestmentLiveNumberDirection(7, value), 'flat');
        updater.updateInvestmentLiveValueNode(node, '0.00', 0);
        assert.equal(node.dataset.investmentLiveNumber, '0');
        assert.equal(node.textContent, '0.00');
        updater.updateInvestmentLiveValueNode(node, 'Unavailable', null);
        assert.equal(Object.hasOwn(node.dataset, 'investmentLiveNumber'), false);
    }
    const stale = new TestElement();
    stale.dataset = {investmentLiveDisplay: 'Unavailable', investmentLiveNumber: 'null'};
    updater.updateInvestmentLiveValueNode(stale, 'Unavailable', null);
    assert.equal(Object.hasOwn(stale.dataset, 'investmentLiveNumber'), false);
    assert.equal(resolveInvestmentLiveNumberDirection(7, 0), 'fall');
    assert.equal(resolveInvestmentLiveNumberDirection(0, 7), 'rise');
});

test('Holdings P&L keeps sign colors and uses its existing neutral display threshold', () => {
    class TestElement {
        classes = new Set();
        classList = {
            remove: (...names) => names.forEach((name) => this.classes.delete(name)),
            toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
        };
    }
    const {syncInvestmentLiveTone} = createInvestmentLiveValueAnimator({
        HTMLElementClass: TestElement,
        neutralEpsilon: 0.005,
    });
    const node = new TestElement();
    const options = {enableSignedTone: true, enableNeutralTone: true};
    for (const value of [-10, -2]) {
        syncInvestmentLiveTone(node, value, options);
        assert.deepEqual([...node.classes], ['investment-holdings-value-negative']);
    }
    for (const value of [-0.004, 0, 0.004]) {
        syncInvestmentLiveTone(node, value, options);
        assert.deepEqual([...node.classes], ['investment-holdings-value-neutral']);
    }
    syncInvestmentLiveTone(node, 2, options);
    assert.deepEqual([...node.classes], ['investment-holdings-value-positive']);
    syncInvestmentLiveTone(node, null, {enableSignedTone: false});
    assert.equal(node.classes.size, 0);
});
