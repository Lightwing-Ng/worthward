/* Personal Stock details cost-lot snapshot tests. Code version: v1.1.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildInvestmentStockDetailsChipSnapshot,
    buildInvestmentStockDetailsChipDisplayParts,
    reconcileInvestmentStockDetailsChipAnchors,
    repriceInvestmentStockDetailsChipSnapshot,
} from '../../../app/web/static/assets/js/investment/stock-details-chips.js';
import {
    createInvestmentStockDetailsChipChart,
} from '../../../app/web/static/assets/js/investment/stock-details-chip-chart.js';
import {
    createInvestmentPositionValuationUtils,
} from '../../../app/web/static/assets/js/investment/data-utils/position-valuation.js';

function position(lots, overrides = {}) {
    return {
        shares: lots.reduce((total, lot) => total + lot.quantity, 0),
        totalCost: lots.reduce((total, lot) => total + Math.abs(lot.quantity) * lot.unitPrice, 0),
        costBasisStatus: 'known',
        lotScope: {currency: 'USD'},
        lots,
        ...overrides,
    };
}

function snapshot(states, options = {}) {
    return buildInvestmentStockDetailsChipSnapshot(new Map(states.map((state, index) => [index, state])), {
        date: '2026-10-23',
        price: 25,
        quoteCurrency: 'USD',
        ...options,
    });
}

test('groups exact remaining basis by price and side while conserving gross quantity and cost', () => {
    const result = snapshot([
        position([{quantity: 3, unitPrice: 20}, {quantity: 2, unitPrice: 30}]),
        position([{quantity: 4, unitPrice: 20}, {quantity: 1, unitPrice: 20.0000001}]),
    ]);

    assert.equal(result.status, 'ready');
    assert.equal(result.date, '2026-10-23');
    assert.equal(result.currency, 'USD');
    assert.equal(result.totalQuantity, 10);
    assert.equal(result.signedQuantity, 10);
    assert.equal(result.maxQuantity, 7);
    assert.deepEqual(result.bins.map(({price, quantity}) => ({price, quantity})), [
        {price: 20, quantity: 7},
        {price: 20.0000001, quantity: 1},
        {price: 30, quantity: 2},
    ]);
    assert.equal(result.bins[0].normalizedWidth, 1);
    assert.equal(result.bins[0].weight, 0.7);
    assert.equal(result.bins[2].profitable, false);
    assert.equal(result.bins[2].unrealizedPnl, -10);
    assert.ok(Math.abs(result.totalCost - 220.0000001) < 1e-10);
    assert.equal(result.weightedAverageCost, result.totalCost / 10);
    assert.equal(result.bins.reduce((total, bin) => total + bin.quantity, 0), result.totalQuantity);
});

test('copies and freezes snapshots before later transaction replay mutates its lots', () => {
    const lots = [{quantity: 5, unitPrice: 20}];
    const state = position(lots);
    const result = snapshot([state]);

    lots[0].quantity = 1;
    lots[0].unitPrice = 100;
    lots.push({quantity: 4, unitPrice: 500});
    state.shares = 99;
    state.lotScope.currency = 'HKD';

    assert.equal(result.totalQuantity, 5);
    assert.equal(result.bins[0].price, 20);
    assert.equal(result.bins[0].quantity, 5);
    assert.deepEqual(result.positionCurrencies, ['USD']);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.bins));
    assert.ok(Object.isFrozen(result.bins[0]));
    assert.ok(Object.isFrozen(result.positionCurrencies));
});

test('preserves zero-cost grants and reverses profit direction for short lots', () => {
    const result = snapshot([
        position([{quantity: 2, unitPrice: 0}, {quantity: 1, unitPrice: 25}]),
        position([{quantity: -2, unitPrice: 30}, {quantity: -1, unitPrice: 20}]),
    ]);

    assert.equal(result.status, 'ready');
    assert.equal(result.totalQuantity, 6);
    assert.equal(result.signedQuantity, 0);
    assert.deepEqual(result.bins.map(({price, side, profitable}) => ({price, side, profitable})), [
        {price: 0, side: 'long', profitable: true},
        {price: 20, side: 'short', profitable: false},
        {price: 25, side: 'long', profitable: true},
        {price: 30, side: 'short', profitable: true},
    ]);
    assert.equal(result.bins[3].signedQuantity, -2);
    assert.equal(result.bins[3].unrealizedPnl, 10);
});

test('keeps opposing positions at the same cost as separate bins despite a zero net position', () => {
    const result = snapshot([
        position([{quantity: 2, unitPrice: 20}]),
        position([{quantity: -2, unitPrice: 20}]),
    ]);

    assert.equal(result.status, 'ready');
    assert.equal(result.totalQuantity, 4);
    assert.equal(result.bins.length, 2);
    assert.equal(result.bins[0].side, 'long');
    assert.equal(result.bins[0].profitable, true);
    assert.equal(result.bins[1].side, 'short');
    assert.equal(result.bins[1].profitable, false);
});

test('does not blend currencies or compare foreign basis with the quote currency', () => {
    const usd = position([{quantity: 2, unitPrice: 20}]);
    const hkd = position([{quantity: 3, unitPrice: 50}], {lotScope: {currency: 'HKD'}});
    const mixed = snapshot([usd, hkd]);
    const mismatch = snapshot([hkd]);

    assert.equal(mixed.status, 'unavailable');
    assert.equal(mixed.reason, 'mixed-currencies');
    assert.deepEqual(mixed.positionCurrencies, ['HKD', 'USD']);
    assert.deepEqual(mixed.bins, []);
    assert.equal(mixed.totalCost, null);
    assert.equal(mismatch.reason, 'currency-mismatch');
});

test('fails closed for partial, unknown, or absent basis status instead of treating zero as known', () => {
    for (const costBasisStatus of ['partial', 'unknown', undefined]) {
        const result = snapshot([position([{quantity: 2, unitPrice: 0}], {costBasisStatus})]);
        assert.equal(result.status, 'unavailable');
        assert.equal(result.reason, costBasisStatus === 'partial' ? 'partial-basis' : 'unknown-basis');
        assert.deepEqual(result.bins, []);
        assert.equal(result.totalCost, null);
    }
});

test('retains partial-history provenance independently from known, reconciled remaining lots', () => {
    const result = snapshot([position([{quantity: 2, unitPrice: 20}], {hasPartialTaxLotHistory: true})]);

    assert.equal(result.status, 'ready');
    assert.equal(result.hasPartialTaxLotHistory, true);
});

test('requires remaining lots to reconcile to state shares and cost without synthesizing average lots', () => {
    const noLots = snapshot([position([], {shares: 5, totalCost: 100})]);
    const missingQuantity = snapshot([position([{quantity: 2, unitPrice: 20}], {shares: 5})]);
    const wrongCost = snapshot([position([{quantity: 2, unitPrice: 20}], {totalCost: 100})]);
    const staleClosedLots = snapshot([position([{quantity: 2, unitPrice: 20}], {shares: 0})]);

    for (const result of [noLots, missingQuantity, wrongCost, staleClosedLots]) {
        assert.equal(result.status, 'unavailable');
        assert.equal(result.reason, 'incomplete-lots');
        assert.deepEqual(result.bins, []);
    }
});

test('rejects missing or invalid lot prices and quantities without coercing them into zero basis', () => {
    for (const unitPrice of [null, undefined, '', NaN, Infinity, -1, false]) {
        const result = snapshot([position([{quantity: 2, unitPrice}], {shares: 2, totalCost: 0})]);
        assert.equal(result.status, 'unavailable');
        assert.equal(result.reason, 'invalid-lots');
    }
    const wrongSide = snapshot([position([{quantity: -2, unitPrice: 20}], {shares: 2})]);
    assert.equal(wrongSide.reason, 'invalid-lots');
});

test('closed scopes do not poison empty or open holdings with historical basis and currency flags', () => {
    const closed = position([], {
        costBasisStatus: 'unknown',
        lotScope: {currency: 'HKD'},
        hasPartialTaxLotHistory: true,
    });
    const empty = snapshot([closed]);
    const open = snapshot([closed, position([{quantity: 2, unitPrice: 20}])]);

    assert.equal(empty.status, 'empty');
    assert.equal(empty.reason, null);
    assert.equal(empty.totalQuantity, 0);
    assert.deepEqual(empty.bins, []);
    assert.equal(open.status, 'ready');
    assert.deepEqual(open.positionCurrencies, ['USD']);
    assert.equal(open.hasPartialTaxLotHistory, false);
});

test('unknown quote prices retain known lots with no fabricated profit classification', () => {
    for (const price of [null, undefined, '', NaN, Infinity, -1]) {
        const result = snapshot([position([{quantity: 2, unitPrice: 20}])], {price});
        assert.equal(result.status, 'ready');
        assert.equal(result.price, null);
        assert.equal(result.bins[0].profitable, null);
        assert.equal(result.bins[0].unrealizedPnl, null);
    }
});

test('uses explicit scope currency or the known ticker quote currency and rejects an unknown currency', () => {
    const state = position([{quantity: 2, unitPrice: 20}], {lotScope: {currency: ''}});
    const fallback = snapshot([state]);
    const unknown = snapshot([state], {quoteCurrency: ''});

    assert.equal(fallback.status, 'ready');
    assert.equal(fallback.currency, 'USD');
    assert.equal(unknown.status, 'unavailable');
    assert.equal(unknown.reason, 'unknown-currency');
});

test('reprices copied long and short bins without changing their date, basis, or quantities', () => {
    const original = snapshot([
        position([{quantity: 2, unitPrice: 20}]),
        position([{quantity: -1, unitPrice: 30}]),
    ]);
    const repriced = repriceInvestmentStockDetailsChipSnapshot(original, 35);

    assert.equal(repriced.date, original.date);
    assert.equal(repriced.status, original.status);
    assert.equal(repriced.totalQuantity, original.totalQuantity);
    assert.equal(repriced.totalCost, original.totalCost);
    assert.equal(repriced.price, 35);
    assert.equal(repriced.bins[0].unrealizedPnl, 30);
    assert.equal(repriced.bins[1].unrealizedPnl, -5);
    assert.equal(repriced.bins[1].profitable, false);
    assert.equal(original.price, 25);
    assert.equal(original.bins[1].unrealizedPnl, 5);
    assert.notEqual(repriced.bins, original.bins);
    assert.notEqual(repriced.bins[0], original.bins[0]);
    assert.ok(Object.isFrozen(repriced));
    assert.ok(Object.isFrozen(repriced.bins));
    assert.ok(Object.isFrozen(repriced.bins[0]));
    assert.deepEqual(repriced.positionCurrencies, original.positionCurrencies);
});

test('repricing unavailable or unknown-price snapshots preserves their state and neutralizes profit', () => {
    const original = snapshot([position([{quantity: 2, unitPrice: 20}])]);
    const neutral = repriceInvestmentStockDetailsChipSnapshot(original, null);
    assert.equal(neutral.price, null);
    assert.equal(neutral.bins[0].profitable, null);
    assert.equal(neutral.bins[0].unrealizedPnl, null);
    assert.equal(original.bins[0].profitable, true);

    const unavailable = snapshot([position([{quantity: 2, unitPrice: 20}], {costBasisStatus: 'unknown'})]);
    const repriced = repriceInvestmentStockDetailsChipSnapshot(unavailable, 50);
    assert.equal(repriced.status, 'unavailable');
    assert.equal(repriced.reason, 'unknown-basis');
    assert.equal(repriced.date, unavailable.date);
    assert.equal(repriced.totalQuantity, unavailable.totalQuantity);
    assert.deepEqual(repriced.bins, []);
});

function anchoredReplay(method = 'lowest_cost_first') {
    const state = position([], {realizedPnl: 0});
    const api = createInvestmentPositionValuationUtils({
        getInvestmentCostBasisMethod: () => method,
        isFlatPosition: (value) => !Number.isFinite(value) || Math.abs(value) < 1e-9,
    });
    const priceAnchorsByState = new WeakMap();
    let tracker = new Map();
    return {
        state,
        api,
        priceAnchorsByState,
        sync(openingDisplayPrice = null, projectAverage = false, openingOrigin = null) {
            tracker = reconcileInvestmentStockDetailsChipAnchors(tracker, state, {
                openingDisplayPrice, projectAverage, openingOrigin,
            });
            priceAnchorsByState.set(state, tracker);
            return tracker;
        },
        snapshot(price = 25) {
            return snapshot([state], {price, priceAnchorsByState});
        },
    };
}

function expectAccountingConservation(result, state, price) {
    const quantity = Math.abs(state.shares);
    assert.equal(result.status, 'ready');
    assert.equal(result.totalQuantity, quantity);
    assert.ok(Math.abs(result.totalCost - state.totalCost) < 1e-9);
    assert.equal(result.weightedAverageCost, result.totalCost / quantity);
    assert.ok(Math.abs(result.bins.reduce((total, bin) => total + bin.quantity, 0) - quantity) < 1e-9);
    assert.ok(Math.abs(result.bins.reduce((total, bin) => total + bin.signedQuantity, 0) - state.shares) < 1e-9);
    assert.ok(Math.abs(result.bins.reduce((total, bin) => total + bin.quantity * bin.costPrice, 0) - state.totalCost) < 1e-9);
    const expectedPnl = Math.sign(state.shares) * (price * quantity - state.totalCost);
    assert.ok(Math.abs(result.bins.reduce((total, bin) => total + bin.unrealizedPnl, 0) - expectedPnl) < 1e-9);
}

test('anchors fee-bearing purchases to execution prices while retaining accounting costs and P&L', () => {
    const replay = anchoredReplay();
    replay.api.openPositionLots(replay.state, 'long', 10, 20.5);
    const tracker = replay.sync(20);
    const result = replay.snapshot(25);

    assert.equal(result.bins[0].price, 20);
    assert.equal(result.bins[0].priceOrigin, 'execution');
    assert.equal(result.bins[0].costPrice, 20.5);
    assert.equal(result.bins[0].unrealizedPnl, 45);
    expectAccountingConservation(result, replay.state, 25);
    const repriced = repriceInvestmentStockDetailsChipSnapshot(result, 20.25);
    assert.equal(repriced.bins[0].price, 20);
    assert.equal(repriced.bins[0].unrealizedPnl, -2.5);
    assert.equal(repriced.bins[0].profitable, false);
    assert.equal(repriced.totalCost, 205);
    assert.ok(Object.isFrozen(tracker.get(replay.state.lots[0])));
    assert.ok(Object.isFrozen(tracker.get(replay.state.lots[0]).parts));
    assert.ok(Object.isFrozen(tracker.get(replay.state.lots[0]).parts[0]));
});

test('partial lot consumes preserve purchase identities and leave older trackers and snapshots frozen', () => {
    const replay = anchoredReplay('fifo');
    replay.api.openPositionLots(replay.state, 'long', 3, 10.1);
    const firstLot = replay.state.lots[0];
    const firstTracker = replay.sync(10);
    replay.api.openPositionLots(replay.state, 'long', 7, 20.1);
    replay.sync(20);
    const original = replay.snapshot();
    replay.api.closePositionLots(replay.state, 2, 25);
    const remainingTracker = replay.sync();
    const remaining = replay.snapshot();

    assert.equal(replay.state.lots[0], firstLot);
    assert.equal(firstTracker.get(firstLot).quantity, 3);
    assert.equal(remainingTracker.get(firstLot).quantity, 1);
    assert.deepEqual(remaining.bins.map(({price, quantity}) => ({price, quantity})), [
        {price: 10, quantity: 1}, {price: 20, quantity: 7},
    ]);
    assert.equal(original.totalQuantity, 10);
    assert.equal(original.bins[0].quantity, 3);
    expectAccountingConservation(remaining, replay.state, 25);
});

test('transfer basis corrections change accounting costs without moving purchase-price anchors', () => {
    const replay = anchoredReplay();
    replay.api.openPositionLots(replay.state, 'long', 10, 10);
    replay.sync(10);
    replay.api.openPositionLots(replay.state, 'long', 10, 20);
    replay.sync(20);
    replay.api.removePositionLots(replay.state, 5, {basisOverride: 10});
    replay.sync();
    const result = replay.snapshot();

    assert.deepEqual(result.bins.map(({price, quantity}) => ({price, quantity})), [
        {price: 10, quantity: 5}, {price: 20, quantity: 10},
    ]);
    assert.ok(result.bins[0].costPrice > 10);
    assert.ok(result.bins[1].costPrice > 20);
    assert.equal(result.totalCost, 290);
    expectAccountingConservation(result, replay.state, 25);
});

test('moving-average sales project surviving quantities across fixed original purchase prices', () => {
    const replay = anchoredReplay('moving_average');
    replay.api.openPositionLots(replay.state, 'long', 3, 10);
    replay.sync(10);
    replay.api.openPositionLots(replay.state, 'long', 7, 20);
    replay.sync(20);
    replay.api.closePositionLots(replay.state, 3, 25);
    const tracker = replay.sync(25, true);
    const result = replay.snapshot();

    assert.equal(replay.state.lots.length, 1);
    assert.equal(replay.state.lots[0].unitPrice, 17);
    assert.deepEqual(result.bins.map(({price}) => price), [10, 20]);
    assert.equal(result.bins.reduce((total, bin) => total + bin.quantity, 0), 7);
    assert.ok(Math.abs(result.bins[0].quantity - 2.1) < 1e-12);
    assert.ok(result.bins.every((bin) => bin.costPrice === 17));
    assert.ok(result.bins.every((bin) => bin.displayPriceProjection === 'proportional-survival'));
    assert.equal(tracker.size, 1);
    expectAccountingConservation(result, replay.state, 25);
});

test('lot object keys survive sequence collisions after average sales and later purchases', () => {
    const replay = anchoredReplay('moving_average');
    replay.api.openPositionLots(replay.state, 'long', 10, 10);
    replay.sync(10);
    replay.api.openPositionLots(replay.state, 'long', 10, 20);
    replay.sync(20);
    replay.api.closePositionLots(replay.state, 5, 25);
    replay.sync(25, true);
    replay.api.openPositionLots(replay.state, 'long', 2, 30);
    const tracker = replay.sync(30, true);

    assert.equal(replay.state.lots[0].sequence, replay.state.lots[1].sequence);
    assert.equal(tracker.size, 2);
    assert.deepEqual(replay.snapshot().bins.map(({price, quantity}) => ({price, quantity})), [
        {price: 10, quantity: 7.5}, {price: 20, quantity: 7.5}, {price: 30, quantity: 2},
    ]);
    replay.api.closePositionLots(replay.state, 3, 25);
    replay.sync(25, true);
    const afterAnotherSale = replay.snapshot();
    assert.deepEqual(afterAnotherSale.bins.map(({price}) => price), [10, 20, 30]);
    assert.equal(afterAnotherSale.bins.reduce((total, bin) => total + bin.quantity, 0), 14);
    expectAccountingConservation(afterAnotherSale, replay.state, 25);
});

test('flat resets and long-to-short reversals create fresh anchors despite reused sequence numbers', () => {
    const replay = anchoredReplay('moving_average');
    replay.api.openPositionLots(replay.state, 'long', 10, 20);
    const oldLot = replay.state.lots[0];
    replay.sync(19.5);
    replay.api.applyDirectionalTrade(replay.state, 'short', 15, 30);
    const tracker = replay.sync(29.5, true);
    const short = replay.snapshot();

    assert.equal(replay.state.lots[0].sequence, oldLot.sequence);
    assert.equal(tracker.has(oldLot), false);
    assert.equal(short.bins[0].price, 29.5);
    assert.equal(short.bins[0].side, 'short');
    expectAccountingConservation(short, replay.state, 25);
    replay.api.closePositionLots(replay.state, 5, 25);
    assert.equal(replay.sync(25, true).size, 0);
    assert.equal(replay.snapshot().status, 'empty');
    replay.api.openPositionLots(replay.state, 'long', 1, 40);
    replay.sync(39.5);
    assert.equal(replay.snapshot().bins[0].price, 39.5);
});

test('zero-price and carried-basis anchors retain provenance while unknown basis stays unavailable', () => {
    const grant = anchoredReplay();
    grant.api.openPositionLots(grant.state, 'long', 2, 0);
    const grantTracker = grant.sync(0, false, 'grant');
    assert.equal(grant.snapshot().bins[0].price, 0);
    assert.equal(grantTracker.get(grant.state.lots[0]).parts[0].origin, 'grant');
    assert.equal(grant.snapshot().bins[0].priceOrigin, 'grant');
    expectAccountingConservation(grant.snapshot(), grant.state, 25);

    const carried = anchoredReplay();
    carried.api.openPositionLots(carried.state, 'long', 2, 22);
    const carriedTracker = carried.sync();
    const parts = buildInvestmentStockDetailsChipDisplayParts(carried.state, carriedTracker);
    assert.equal(parts[0].price, 22);
    assert.equal(parts[0].origin, 'carried-basis');
    assert.equal(carried.snapshot().bins[0].priceOrigin, 'carried-basis');
    assert.ok(Object.isFrozen(parts));
    assert.ok(Object.isFrozen(parts[0]));
    carried.state.costBasisStatus = 'unknown';
    assert.equal(carried.snapshot().reason, 'unknown-basis');
});

test('same display prices keep distinct accounting costs and do not blend P&L classification', () => {
    const replay = anchoredReplay();
    replay.api.openPositionLots(replay.state, 'long', 1, 19);
    replay.sync(20);
    replay.api.openPositionLots(replay.state, 'long', 1, 21);
    replay.sync(20);
    const result = replay.snapshot(20);

    assert.equal(result.bins.length, 2);
    assert.deepEqual(result.bins.map(({price, costPrice, profitable}) => ({price, costPrice, profitable})), [
        {price: 20, costPrice: 19, profitable: true},
        {price: 20, costPrice: 21, profitable: false},
    ]);
    expectAccountingConservation(result, replay.state, 20);
});

test('invalid or stale display anchors fail closed without masking invalid accounting lots', () => {
    const state = position([{quantity: 2, unitPrice: 20}]);
    const valid = reconcileInvestmentStockDetailsChipAnchors(null, state, {openingDisplayPrice: 19});
    const anchors = new WeakMap([[state, new Map()]]);
    assert.equal(snapshot([state], {priceAnchorsByState: anchors}).reason, 'incomplete-price-anchors');
    const broken = new Map(valid);
    broken.set(state.lots[0], {quantity: 2, parts: [{price: 19, quantity: 1}]});
    anchors.set(state, broken);
    assert.equal(buildInvestmentStockDetailsChipDisplayParts(state, broken), null);
    assert.equal(snapshot([state], {priceAnchorsByState: anchors}).reason, 'incomplete-price-anchors');
    assert.equal(reconcileInvestmentStockDetailsChipAnchors(broken, state).size, 0);
    anchors.set(state, valid);
    state.totalCost = 99;
    assert.equal(snapshot([state], {priceAnchorsByState: anchors}).reason, 'incomplete-lots');
    state.costBasisStatus = 'partial';
    assert.equal(snapshot([state], {priceAnchorsByState: anchors}).reason, 'partial-basis');
});

test('identical prices retain separate execution and carried origins and identify missing tracked history', () => {
    const execution = position([{quantity: 2, unitPrice: 20}]);
    const carried = position([{quantity: 3, unitPrice: 20}]);
    const priceAnchorsByState = new WeakMap([
        [execution, reconcileInvestmentStockDetailsChipAnchors(null, execution, {openingDisplayPrice: 20})],
        [carried, reconcileInvestmentStockDetailsChipAnchors(null, carried, {openingOrigin: 'carried-basis'})],
    ]);
    const result = snapshot([execution, carried], {priceAnchorsByState});
    assert.deepEqual(result.bins.map(({priceOrigin, quantity}) => ({priceOrigin, quantity})), [
        {priceOrigin: 'execution', quantity: 2}, {priceOrigin: 'carried-basis', quantity: 3},
    ]);
    const missing = snapshot([execution], {priceAnchorsByState: new WeakMap()});
    assert.equal(missing.bins[0].priceOrigin, 'cost-basis');
    assert.equal(missing.totalCost, execution.totalCost);
});

test('renders chip snapshots without visible date or summary nodes while retaining accessible context', (t) => {
    const previousWindow = globalThis.window;
    const listeners = new Map();
    globalThis.window = {
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type, listener) => {
            if (listeners.get(type) === listener) listeners.delete(type);
        },
    };
    t.after(() => {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    });
    const canvas = {
        isConnected: false,
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
    };
    const emptyLabel = {hidden: false, textContent: ''};
    const card = {
        dataset: {},
        querySelector(selector) {
            return {
                '[data-investment-stock-chips-canvas]': canvas,
                '[data-investment-stock-chips-empty]': emptyLabel,
            }[selector] || null;
        },
    };
    const chart = createInvestmentStockDetailsChipChart(card);
    const ready = snapshot([position([{quantity: 1_234, unitPrice: 20}])], {
        date: '2026-10-28T14:35:00Z',
    });

    chart.render(ready);
    assert.equal(card.dataset.date, '2026-10-28T14:35:00Z');
    assert.equal(card.dataset.totalQuantity, '1234');
    assert.equal(card.dataset.status, 'ready');
    assert.equal(emptyLabel.hidden, true);
    assert.equal(canvas.attributes['aria-label'],
        'Cost distribution on 28 Oct 2026 14:35. 1,234 long shares at USD 20. Reference line: last price 25.');

    chart.render(snapshot([]));
    assert.equal(card.dataset.status, 'empty');
    assert.equal(card.dataset.totalQuantity, '0');
    assert.equal(emptyLabel.hidden, false);
    assert.equal(canvas.attributes['aria-label'], 'No open lots at this time.');
    chart.destroy();
    assert.equal(listeners.size, 0);
});
