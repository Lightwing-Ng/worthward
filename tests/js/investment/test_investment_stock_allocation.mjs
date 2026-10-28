/* Stock-details total-equity allocation. Code version: v1.2.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentStockHistoryFilterRuntime,
} from '../../../app/web/static/assets/js/investment/runtime/stock-history-filters.js';

const summary = {ticker: 'QQQI', marketValue: 1_000_000};

function build(point, tickerSummary = summary, activeTicker = '') {
    return createInvestmentStockHistoryFilterRuntime({state: {}})
        .buildStockDetailsAllocationState(point, tickerSummary, activeTicker);
}

function point(overrides = {}) {
    return {
        date: '2026-10-27',
        aggregate_display_cash: 100,
        aggregate_holdings_market_values: {QQQI: 300, OTHER: 600},
        aggregate_total_equity: 1_000,
        ...overrides,
    };
}

test('uses total equity as the denominator for selected stock, cash, and other stocks', () => {
    assert.deepEqual(build(point()), {
        ticker: 'QQQI',
        date: '2026-10-27',
        status: 'ready',
        denominator: 1_000,
        cashValue: 100,
        tickerValue: 300,
        otherValue: 600,
        cashRatio: 0.1,
        tickerRatio: 0.3,
        otherRatio: 0.6,
    });
});

test('uses the supplied historical snapshot rather than the latest ticker summary', () => {
    const historical = build(point({
        date: '2026-08-20',
        aggregate_display_cash: 900,
        aggregate_holdings_market_values: {QQQI: 100},
    }));
    const current = build(point());
    assert.equal(historical.date, '2026-08-20');
    assert.equal(historical.tickerValue, 100);
    assert.equal(historical.cashRatio, 0.9);
    assert.equal(historical.tickerRatio, 0.1);
    assert.equal(current.tickerValue, 300);
    assert.equal(historical.tickerValue, 100);
});

test('uses the explicitly selected ticker when several securities share the snapshot', () => {
    const result = build(point(), summary, 'other');
    assert.equal(result.ticker, 'OTHER');
    assert.equal(result.denominator, 1_000);
    assert.equal(result.tickerValue, 600);
    assert.equal(result.otherValue, 300);
    assert.equal(result.cashRatio, 0.1);
    assert.equal(result.tickerRatio, 0.6);
    assert.equal(result.otherRatio, 0.3);
    assert.equal(result.cashRatio + result.tickerRatio + result.otherRatio, 1);
});

test('preserves explicitly unknown display cash instead of falling back to another balance', () => {
    for (const amount of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '', true, -1]) {
        const result = build(point({aggregate_display_cash: amount, aggregate_running_cash: 100}));
        assert.equal(result.status, 'unavailable', `Unknown or negative cash: ${String(amount)}`);
        assert.equal(result.cashRatio, null);
        assert.equal(result.tickerRatio, null);
    }
});

test('keeps unknown or short selected valuations unavailable without clamping them to zero', () => {
    for (const amount of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '', false, -300]) {
        const result = build(point({aggregate_holdings_market_values: {QQQI: amount}}));
        assert.equal(result.status, 'unavailable', `Unknown or short valuation: ${String(amount)}`);
        assert.equal(result.denominator, null);
    }
});

test('requires price coverage for the selected stock and every other stock in total equity', () => {
    assert.equal(build(point({missing_price_tickers: ['qqqi']})).status, 'unavailable');
    assert.equal(build(point({missing_price_tickers: ['OTHER']})).status, 'unavailable');
});

test('does not infer a zero selected valuation when its open quantity lacks a market value', () => {
    const result = build(point({
        aggregate_holdings_market_values: {OTHER: 600},
        aggregate_holdings: {QQQI: 3},
    }));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.cashRatio, null);
});

test('reports an empty allocation when all evidenced components and total equity are zero', () => {
    const result = build(point({aggregate_display_cash: 0, aggregate_holdings_market_values: {}, aggregate_total_equity: 0}));
    assert.equal(result.status, 'empty');
    assert.equal(result.denominator, 0);
    assert.equal(result.cashValue, 0);
    assert.equal(result.tickerValue, 0);
    assert.equal(result.otherValue, 0);
    assert.equal(result.cashRatio, null);
    assert.equal(result.tickerRatio, null);
    assert.equal(result.otherRatio, null);
});

test('supports cash-only, selected-only, and other-stock-only equity without inventing a remainder', () => {
    const cash = build(point({aggregate_holdings_market_values: {}, aggregate_total_equity: 100}));
    assert.equal(cash.status, 'ready');
    assert.equal(cash.cashRatio, 1);
    assert.equal(cash.tickerRatio, 0);
    assert.equal(cash.otherRatio, 0);
    const invested = build(point({aggregate_display_cash: 0, aggregate_holdings_market_values: {QQQI: 300}, aggregate_total_equity: 300}));
    assert.equal(invested.cashRatio, 0);
    assert.equal(invested.tickerRatio, 1);
    assert.equal(invested.otherRatio, 0);
    const other = build(point({aggregate_display_cash: 0, aggregate_holdings_market_values: {OTHER: 600}, aggregate_total_equity: 600}));
    assert.equal(other.cashRatio, 0);
    assert.equal(other.tickerRatio, 0);
    assert.equal(other.otherRatio, 1);
});

test('fails closed without a snapshot, ticker, or valuation map', () => {
    assert.equal(build(null).status, 'unavailable');
    assert.equal(build(point(), {ticker: ''}).status, 'unavailable');
    assert.equal(build({aggregate_display_cash: 100}).status, 'unavailable');
    assert.equal(build(point({aggregate_holdings_market_values: []})).status, 'unavailable');
});

test('uses local-scope aliases only when aggregate fields are absent', () => {
    const result = build({
        date: '2026-08-20',
        running_cash: 50,
        holdings_market_values: {QQQI: 150},
        total_equity: 200,
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.cashRatio, 0.25);
    assert.equal(result.tickerRatio, 0.75);
    assert.equal(build(point({aggregate_holdings_market_values: null, holdings_market_values: {QQQI: 150}})).status, 'unavailable');
});

test('preserves an explicitly unknown aggregate equity instead of using an alias or component total', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '', true, -1, [], {}]) {
        const result = build(point({aggregate_total_equity: value, total_equity: 1_000}));
        assert.equal(result.status, 'unavailable', `Unknown equity: ${String(value)}`);
        assert.equal(result.denominator, null);
        assert.equal(result.otherRatio, null);
    }
    const noEquity = point();
    delete noEquity.aggregate_total_equity;
    assert.equal(build(noEquity).status, 'unavailable');
});

test('does not turn a non-stock NAV component into other stocks', () => {
    for (const adjustment of [6.5, -6.5, 1, -1]) {
        const result = build(point({
            aggregate_total_equity: 1_000 + adjustment,
            aggregate_interest_accrual: adjustment,
        }));
        assert.equal(result.status, 'unavailable');
        assert.equal(result.otherValue, null);
    }
    assert.equal(build(point({aggregate_total_equity: 0})).status, 'unavailable');
});

test('rejects unknown or negative other-stock valuations and incomplete portfolio coverage', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '', false, -600, [], {}]) {
        assert.equal(build(point({aggregate_holdings_market_values: {QQQI: 300, OTHER: value}})).status, 'unavailable');
    }
    assert.equal(build(point({valuation_complete: false})).status, 'unavailable');
});

test('allows ordinary floating-point addition error without replacing total equity', () => {
    const result = build(point({
        aggregate_display_cash: 0.1,
        aggregate_holdings_market_values: {QQQI: 0.2},
        aggregate_total_equity: 0.3,
    }));
    assert.equal(result.status, 'ready');
    assert.equal(result.denominator, 0.3);
    assert.equal(result.otherValue, 0);
});

function prepareAllocationDom(t) {
    class Element {
        constructor(children = {}) {
            this.children = children;
            this.dataset = {};
            this.style = {};
            this.attributes = {};
            this.textContent = '';
        }

        querySelector(selector) {
            return this.children[selector] || null;
        }

        setAttribute(name, value) {
            this.attributes[name] = value;
        }
    }
    const previousHTMLElement = globalThis.HTMLElement;
    globalThis.HTMLElement = Element;
    t.after(() => { globalThis.HTMLElement = previousHTMLElement; });
    const bar = new Element();
    const cash = new Element();
    const ticker = new Element();
    const other = new Element();
    const cashValue = new Element();
    const tickerValue = new Element();
    const tickerLabel = new Element();
    const card = new Element({
        '[data-investment-stock-allocation-bar]': bar,
        '[data-investment-stock-allocation-cash]': cash,
        '[data-investment-stock-allocation-ticker]': ticker,
        '[data-investment-stock-allocation-other]': other,
        '[data-investment-stock-allocation-cash-value]': cashValue,
        '[data-investment-stock-allocation-ticker-value]': tickerValue,
        '[data-investment-stock-allocation-ticker-label]': tickerLabel,
    });
    const runtime = {
        state: {},
        investmentStockDetailsPanel: new Element({'[data-investment-stock-allocation]': card}),
        ensureSelectedInvestmentStockTicker: () => 'QQQI',
        resolveInvestmentTickerProfile: () => ({}),
    };
    return {
        api: createInvestmentStockHistoryFilterRuntime(runtime),
        runtime,
        card, bar, cash, ticker, other, cashValue, tickerValue, tickerLabel,
    };
}

test('renders all three exact component widths and describes the total-equity denominator', (t) => {
    const dom = prepareAllocationDom(t);
    dom.api.renderInvestmentStockDetailsAllocation(point(), summary);
    assert.equal(dom.card.dataset.status, 'ready');
    assert.equal(dom.card.dataset.date, '2026-10-27');
    assert.equal(dom.card.dataset.cashRatio, '0.1');
    assert.equal(dom.card.dataset.tickerRatio, '0.3');
    assert.equal(dom.card.dataset.otherRatio, '0.6');
    assert.equal(dom.card.dataset.denominator, '1000');
    assert.equal(dom.cash.style.width, '10%');
    assert.equal(dom.ticker.style.width, '30%');
    assert.equal(dom.other.style.width, '60%');
    assert.equal(dom.cashValue.textContent, '10.00%');
    assert.equal(dom.tickerValue.textContent, '30.00%');
    assert.equal(dom.tickerLabel.textContent, 'QQQI');
    assert.match(dom.card.title, /total equity/);
    assert.match(dom.bar.attributes['aria-label'], /QQQI 30\.00%; Cash 10\.00%; Other stocks 60\.00%/);
    assert.match(dom.bar.attributes['aria-label'], /total equity/);
});

test('clears a prior allocation when the next historical snapshot is unavailable', (t) => {
    const dom = prepareAllocationDom(t);
    dom.api.renderInvestmentStockDetailsAllocation(point(), summary);
    dom.api.renderInvestmentStockDetailsAllocation(point({date: '2026-08-20', aggregate_display_cash: null}), summary);
    assert.equal(dom.card.dataset.date, '2026-08-20');
    assert.equal(dom.card.dataset.status, 'unavailable');
    assert.equal(dom.card.dataset.cashRatio, '');
    assert.equal(dom.card.dataset.tickerRatio, '');
    assert.equal(dom.card.dataset.otherRatio, '');
    assert.equal(dom.cash.style.width, '0%');
    assert.equal(dom.ticker.style.width, '0%');
    assert.equal(dom.other.style.width, '0%');
    assert.equal(dom.cashValue.textContent, '-');
    assert.equal(dom.tickerValue.textContent, '-');
    assert.match(dom.bar.attributes['aria-label'], /Allocation unavailable/);
});

test('describes an empty allocation without displaying invented percentages', (t) => {
    const dom = prepareAllocationDom(t);
    dom.api.renderInvestmentStockDetailsAllocation(point({aggregate_display_cash: 0, aggregate_holdings_market_values: {}, aggregate_total_equity: 0}), summary);
    assert.equal(dom.card.dataset.status, 'empty');
    assert.equal(dom.cashValue.textContent, '-');
    assert.equal(dom.tickerValue.textContent, '-');
    assert.match(dom.bar.attributes['aria-label'], /No equity components/);
});

function prepareAllocationInteraction(t) {
    const dom = prepareAllocationDom(t);
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {ticker_profiles: {}}};
    t.after(() => { globalThis.window = previousWindow; });
    const historical = point({
        date: '2026-08-20',
        aggregate_display_cash: 300,
        aggregate_holdings_market_values: {QQQI: 100},
        aggregate_total_equity: 400,
    });
    const latest = point();
    Object.assign(dom.runtime.state, {
        investmentTickerSummariesCache: [summary],
        investmentChartPointsCache: [historical, latest],
        activeChartTooltipPointRecord: historical,
        activeChartTooltipPointIndex: 0,
        activeHoldingsHoverLedgerNo: 7,
        activeHoldingsHoverTicker: 'QQQI',
        investmentChartPointIndexByLedgerNo: new Map([[7, 0]]),
        investmentLatestChartPoint: latest,
    });
    return {...dom, historical, latest};
}

test('restores latest allocation after price hover even when another interaction retains an old point', (t) => {
    const dom = prepareAllocationInteraction(t);
    dom.api.syncInvestmentStockDetailsDonutFromInteraction();
    assert.equal(dom.card.dataset.date, '2026-08-20');
    assert.equal(dom.card.dataset.cashRatio, '0.75');
    dom.api.syncInvestmentStockDetailsDonutFromInteraction({preferLatest: true});
    assert.equal(dom.card.dataset.date, '2026-10-27');
    assert.equal(dom.card.dataset.cashRatio, '0.1');
    assert.equal(dom.card.dataset.tickerRatio, '0.3');
    assert.equal(dom.card.dataset.otherRatio, '0.6');
    assert.equal(dom.runtime.state.activeChartTooltipPointRecord, null);
    assert.equal(dom.runtime.state.activeChartTooltipPointIndex, -1);
    assert.equal(dom.runtime.state.activeHoldingsHoverLedgerNo, 0);
    assert.equal(dom.runtime.state.activeHoldingsHoverTicker, '');
    for (let refresh = 0; refresh < 2; refresh += 1) {
        dom.api.syncInvestmentStockDetailsDonutFromInteraction();
        assert.equal(dom.card.dataset.date, '2026-10-27');
        assert.equal(dom.card.dataset.cashRatio, '0.1');
        assert.equal(dom.card.dataset.tickerRatio, '0.3');
        assert.equal(dom.card.dataset.otherRatio, '0.6');
    }
});

test('latest reset clears a stale stock hover while a new stock interaction can select history', (t) => {
    const dom = prepareAllocationInteraction(t);
    dom.runtime.state.activeStockDetailsHoverPointRecord = dom.historical;
    dom.api.syncInvestmentStockDetailsDonutFromInteraction({preferLatest: true});
    assert.equal(dom.card.dataset.date, '2026-10-27');
    assert.equal(dom.runtime.state.activeStockDetailsHoverPointRecord, null);
    dom.api.syncInvestmentStockDetailsDonutFromInteraction();
    assert.equal(dom.card.dataset.date, '2026-10-27');
    dom.runtime.state.activeStockDetailsHoverPointRecord = dom.historical;
    dom.api.syncInvestmentStockDetailsDonutFromInteraction();
    assert.equal(dom.card.dataset.date, '2026-08-20');
});

test('explicit latest selection stays unavailable when no latest snapshot is evidenced', (t) => {
    const dom = prepareAllocationInteraction(t);
    dom.runtime.state.investmentLatestChartPoint = null;
    dom.api.syncInvestmentStockDetailsDonutFromInteraction({preferLatest: true});
    assert.equal(dom.card.dataset.status, 'unavailable');
    assert.equal(dom.card.dataset.date, '');
    assert.equal(dom.cash.style.width, '0%');
    assert.equal(dom.ticker.style.width, '0%');
});
