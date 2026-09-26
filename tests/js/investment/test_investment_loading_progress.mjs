/* Measured Holdings loading lifecycle. Code version: v1.0.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentMetricsImportRuntime,
    waitForInvestmentLoadingPaint,
} from '../../../app/web/static/assets/js/investment/runtime/metrics-import.js';
import {
    createInvestmentStockHistoryFilterRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/stock-history-filters.js';
import {
    createInvestmentTransactionTableRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/transaction-table.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return {promise, resolve, reject};
}

function prepareRuntime(t, overrides = {}) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;
    globalThis.window = {
        location: {pathname: '/trade/investment', search: '?view=holdings'},
    };
    globalThis.document = {visibilityState: 'visible'};
    t.after(() => {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
        globalThis.fetch = originalFetch;
    });
    const runtime = {
        state: {investmentPageDisposed: false, investmentProcessedTransactionsCache: []},
        reportInvestmentFetchAbortDebug() {},
        applyInvestmentVerifiedTaxLotCompatibilityFallbacks: () => [],
        clearStaleTransferReviewFeedback() {},
        applyInvestmentUrlStateFromLocation() {},
        scheduleInvestmentSegmentedPillUpdate() {},
        async renderTransactionTable(_transactions, {onLoadingStep} = {}) {
            await onLoadingStep?.(2, 'History ready.');
            await onLoadingStep?.(3, 'Replay rendered.');
            return {isDegraded: false};
        },
        ...overrides,
    };
    return {...runtime, api: createInvestmentMetricsImportRuntime(runtime)};
}

test('progress remains at zero until the real request completes and finishes after view application', async (t) => {
    const response = deferred();
    const history = deferred();
    const waitingForHistory = deferred();
    const completePaint = deferred();
    const reachedComplete = deferred();
    let viewApplied = false;
    const runtime = prepareRuntime(t, {
        async renderTransactionTable(_transactions, {onLoadingStep}) {
            waitingForHistory.resolve();
            await history.promise;
            await onLoadingStep(2, 'History ready.');
            await onLoadingStep(3, 'Replay rendered.');
            return {isDegraded: false};
        },
        applyInvestmentUrlStateFromLocation() { viewApplied = true; },
    });
    const requestStarted = deferred();
    globalThis.fetch = () => {
        requestStarted.resolve();
        return response.promise;
    };
    const updates = [];
    let finished = false;
    const pending = runtime.api.fetchInvestmentData({onProgress: async (progress) => {
        updates.push(progress);
        if (progress.completed === 4) {
            assert.equal(viewApplied, true);
            reachedComplete.resolve();
            await completePaint.promise;
        }
    }}).then((result) => {
        finished = true;
        return result;
    });
    await requestStarted.promise;
    assert.deepEqual(updates.map((update) => update.completed), [0]);
    response.resolve({ok: true, status: 200, json: async () => ({transactions: []})});
    await waitingForHistory.promise;
    assert.deepEqual(updates.map((update) => update.completed), [0, 1]);
    assert.equal(viewApplied, false);
    history.resolve();
    await reachedComplete.promise;
    assert.deepEqual(updates.map((update) => update.completed), [0, 1, 2, 3, 4]);
    assert.ok(updates.every((update) => update.total === 4));
    assert.equal(finished, false, 'completion waits for the caller to paint the full circle');
    completePaint.resolve();
    await pending;
    assert.equal(finished, true);
});

test('failed responses and mismatched committed versions never advance the first step', async (t) => {
    const runtime = prepareRuntime(t);
    for (const [response, options, message] of [
        [{ok: false, status: 503, json: async () => ({success: false, error: 'Unavailable'})}, {}, /Unavailable/],
        [{ok: true, status: 200, json: async () => ({investment_store_version: 'old'})}, {expectedStoreVersion: 'new'}, /committed store version/],
    ]) {
        const updates = [];
        globalThis.fetch = async () => response;
        await assert.rejects(runtime.api.fetchInvestmentData({
            ...options,
            onProgress: ({completed}) => updates.push(completed),
        }), message);
        assert.deepEqual(updates, [0]);
    }
});

test('a disposed page does not apply a late response or report completion', async (t) => {
    let rendered = false;
    const runtime = prepareRuntime(t, {
        renderTransactionTable() { rendered = true; },
    });
    const response = deferred();
    const requestStarted = deferred();
    globalThis.fetch = () => { requestStarted.resolve(); return response.promise; };
    const updates = [];
    const pending = runtime.api.fetchInvestmentData({onProgress: ({completed}) => updates.push(completed)});
    await requestStarted.promise;
    runtime.state.investmentPageDisposed = true;
    response.resolve({ok: true, status: 200, json: async () => ({transactions: []})});
    await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(rendered, false);
    assert.deepEqual(updates, [0]);
    assert.equal(window.WORTHWARD_INVESTMENT_DATA, undefined);
});

test('an older response cannot overwrite the newest request or complete its progress', async (t) => {
    const runtime = prepareRuntime(t);
    const firstResponse = deferred();
    const firstStarted = deferred();
    const latestData = {transactions: [], investment_store_version: 'latest'};
    let requestCount = 0;
    globalThis.fetch = () => {
        requestCount += 1;
        if (requestCount === 1) {
            firstStarted.resolve();
            return firstResponse.promise;
        }
        return Promise.resolve({ok: true, status: 200, json: async () => latestData});
    };
    const olderUpdates = [];
    const older = runtime.api.fetchInvestmentData({onProgress: ({completed}) => olderUpdates.push(completed)});
    await firstStarted.promise;
    await runtime.api.fetchInvestmentData();
    firstResponse.resolve({ok: true, status: 200, json: async () => ({transactions: []})});
    await assert.rejects(older, {name: 'AbortError'});
    assert.equal(window.WORTHWARD_INVESTMENT_DATA, latestData);
    assert.deepEqual(olderUpdates, [0]);
});

test('a replay failure or interruption never reports completion', async (t) => {
    const runtime = prepareRuntime(t, {
        async renderTransactionTable(_transactions, {onLoadingStep}) {
            await onLoadingStep(2, 'History ready.');
            throw new DOMException('History aborted.', 'AbortError');
        },
    });
    globalThis.fetch = async () => ({ok: true, status: 200, json: async () => ({transactions: []})});
    const updates = [];
    await assert.rejects(runtime.api.fetchInvestmentData({
        onProgress: ({completed}) => updates.push(completed),
    }), {name: 'AbortError'});
    assert.deepEqual(updates, [0, 1, 2]);
    assert.equal(runtime.state.investmentUrlStateApplying, undefined);
});

test('empty stored activity completes history and rendering work only after its empty view exists', async () => {
    const body = {innerHTML: ''};
    const updates = [];
    const runtime = new Proxy({
        state: {},
        getInvestmentHistoryTableBody: () => body,
    }, {get: (target, key) => key in target ? target[key] : () => {}});
    const api = createInvestmentTransactionTableRuntime(runtime);
    await api.renderTransactionTable([], {onLoadingStep: (completed) => {
        updates.push(completed);
        if (completed === 3) assert.match(body.innerHTML, /data-table-empty-row/);
    }});
    assert.deepEqual(updates, [2, 3]);
});

test('modal reuse and dismissal restore fixed loading and ignore stale updates', (t) => {
    const runtime = prepareRuntime(t);
    const attributes = new Map();
    Object.assign(runtime, {
        workspaceModalOverlay: {hidden: true},
        workspaceModalOverlayIcon: {className: '', setAttribute: (key, value) => attributes.set(key, value)},
        workspaceModalOverlayTitle: {textContent: ''},
        workspaceModalOverlayCopy: {textContent: ''},
        WORKSPACE_MODAL_DEFAULT_TITLE: 'Working',
        WORKSPACE_MODAL_DEFAULT_COPY: 'Please wait.',
        WORKSPACE_MODAL_DEFAULT_ICON_CLASS: 'icon workspace-modal-icon',
        INVESTMENT_LOADING_MODAL_TITLE: 'Loading investment data',
        INVESTMENT_LOADING_MODAL_COPY: 'Reading activity.',
        INVESTMENT_LOADING_MODAL_ICON_CLASS: 'suggestion-loading-spinner',
    });
    const updates = [];
    window.WORTHWARD_LOADING_INDICATOR = {setProgress: (_element, options) => updates.push(options)};
    const api = createInvestmentStockHistoryFilterRuntime(runtime);
    const previousOwner = api.showInvestmentLoadingModal({determinate: true});
    api.updateInvestmentLoadingProgress({completed: 3, total: 4, label: 'Applying Holdings.'});
    assert.equal(updates.at(-1).value, 75);
    assert.equal(attributes.get('aria-valuetext'), '3 of 4 loading steps complete. Applying Holdings.');
    api.showInvestmentImportProgressModal();
    assert.equal(updates.at(-1).determinate, false);
    const importCopy = runtime.workspaceModalOverlayCopy.textContent;
    const activeUpdateCount = updates.length;
    api.hideInvestmentLoadingModal({resetContent: true, owner: previousOwner});
    api.updateInvestmentLoadingProgress({completed: 4, total: 4, label: 'Done.', owner: previousOwner});
    assert.equal(runtime.workspaceModalOverlay.hidden, false, 'a stale request cannot hide a newer modal');
    assert.equal(runtime.workspaceModalOverlayCopy.textContent, importCopy);
    assert.equal(updates.length, activeUpdateCount);
    api.hideInvestmentLoadingModal({resetContent: true});
    const updateCount = updates.length;
    api.updateInvestmentLoadingProgress({completed: 4, total: 4, label: 'Done.'});
    assert.equal(updates.length, updateCount);
    assert.equal(runtime.workspaceModalOverlayCopy.textContent, 'Please wait.');
});

test('paint checkpoints finish when hidden and cancel their pending frames and listeners', async () => {
    const events = new Map();
    const frames = new Map();
    let frameSerial = 0;
    const browserDocument = {
        visibilityState: 'visible',
        addEventListener: (type, listener) => events.set(type, listener),
        removeEventListener: (type) => events.delete(type),
    };
    const browserWindow = {
        requestAnimationFrame: (callback) => { frames.set(++frameSerial, callback); return frameSerial; },
        cancelAnimationFrame: (id) => frames.delete(id),
        addEventListener: (type, listener) => events.set(type, listener),
        removeEventListener: (type) => events.delete(type),
    };
    const paint = waitForInvestmentLoadingPaint(browserWindow, browserDocument);
    assert.equal(frames.size, 1);
    browserDocument.visibilityState = 'hidden';
    events.get('visibilitychange')();
    await paint;
    assert.equal(frames.size, 0);
    assert.equal(events.size, 0);
    await waitForInvestmentLoadingPaint(browserWindow, browserDocument);
    assert.equal(frameSerial, 1, 'an already hidden tab does not request a suspended frame');
});

test('visible paint checkpoints provide a frame boundary before completing', async () => {
    const events = new Map();
    const frames = new Map();
    let frameSerial = 0;
    const browserDocument = {
        visibilityState: 'visible',
        addEventListener: (type, listener) => events.set(type, listener),
        removeEventListener: (type) => events.delete(type),
    };
    const browserWindow = {
        requestAnimationFrame: (callback) => { frames.set(++frameSerial, callback); return frameSerial; },
        cancelAnimationFrame: (id) => frames.delete(id),
        addEventListener: (type, listener) => events.set(type, listener),
        removeEventListener: (type) => events.delete(type),
    };
    let finished = false;
    const paint = waitForInvestmentLoadingPaint(browserWindow, browserDocument).then(() => { finished = true; });
    frames.get(1)();
    assert.equal(finished, false);
    frames.get(2)();
    await paint;
    assert.equal(finished, true);
    assert.equal(events.size, 0);
    assert.equal(frames.size, 0);
});
