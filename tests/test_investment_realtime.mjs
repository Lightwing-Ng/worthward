/* Tests for Investment realtime polling and value transitions. Code version: v1.1.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_REALTIME_MODULE_VERSION,
    alignInvestmentLiveSegmentChars,
    buildInvestmentLiveSegmentPairs,
    parseInvestmentLiveDisplaySegments,
    resolveInvestmentLiveNumberDirection,
    createInvestmentRealtimeQuotePoller,
} from '../app/web/static/assets/js/investment/realtime.js';

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
    await Promise.resolve();
    poller.stop();
    assert.equal(capturedSignal.aborted, true);
    releaseRequest([]);
    await pending;
});
