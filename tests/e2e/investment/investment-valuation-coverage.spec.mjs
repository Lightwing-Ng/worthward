/* Code version: v1.0.5 */
import {expect, test} from '@playwright/test';

// Fixtures are intercepted in the browser and never enter a persistent store.
const loadHoldings = async (page, {foreignCash = false, cashType = 'deposit', fx = {}} = {}) => {
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() !== 'GET') return route.abort();
        await route.fulfill({json: {
            success: true, starting_cash: 10000, base_currency: 'USD', brokers: ['ibkr'],
            transactions: foreignCash ? [
                {broker: 'ibkr', account: 'TEST', date: '2026-01-01', type: 'buy', currency: 'USD', ticker: 'AAPL', quantity: 10, price: 100, amount: -1000},
                {broker: 'ibkr', account: 'TEST', date: '2026-01-02', type: cashType, currency: 'HKD', amount: 1000},
            ] : [
                {broker: 'ibkr', account: 'TEST', date: '2026-01-02', type: 'buy', currency: 'USD', ticker: 'AAPL', quantity: 10, price: 100, amount: -1000},
                {broker: 'ibkr', account: 'TEST', date: '2026-01-02', type: 'buy', currency: 'HKD', ticker: '5.HK', quantity: 10, price: 100, amount: -1000},
            ],
            price_history_by_ticker: {AAPL: [{date: '2026-01-02', close: 110}], '5.HK': [{date: '2026-01-02', close: 110}]},
            ticker_profiles: {}, money_market_tickers: [], cash_equivalent_tickers: ['5.HK'],
            fx_rate_history_by_currency: fx, ticker_lineage: {}, summary: {}, broker_summaries: {},
            credit_card_rewards: {status: 'complete', transactions: [], fx_rate_history_by_currency: {}},
            realtime_quotes: [], section_freshness: {},
        }});
    });
    await page.route('**/api/investment/realtime-quotes?*', route => route.fulfill({json: {success: true, quotes: []}}));
    await page.route('**/api/market-session/us-equity?*', route => route.fulfill({json: {success: true, session: 'off', is_trading_day: false, is_realtime_allowed: false, trading_days: []}}));
    await page.goto('/trade/investment?view=holdings');
};

const loadAccrualHoldings = async (page, {currency = 'USD'} = {}) => {
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() !== 'GET') return route.abort();
        await route.fulfill({json: {
            success: true,
            starting_cash: 10000,
            base_currency: 'USD',
            brokers: ['ibkr'],
            transactions: [
                {broker: 'ibkr', account: 'TEST', date: '2026-06-26', type: 'buy', currency: 'USD', ticker: 'AAPL', quantity: 10, price: 100, amount: -1000},
            ],
            price_history_by_ticker: {AAPL: [{date: '2026-06-26', close: 110}]},
            ticker_profiles: {},
            money_market_tickers: [],
            cash_equivalent_tickers: [],
            fx_rate_history_by_currency: {},
            ticker_lineage: {},
            summary: {},
            broker_summaries: {},
            broker_snapshots: {
                'ibkr:TEST': {
                    broker: 'ibkr',
                    account: 'TEST',
                    interest_accrual_snapshots: [
                        {as_of: '2026-06-26', status: 'reported', currency, amount: '-6.5'},
                    ],
                },
            },
            realtime_quotes: [],
            section_freshness: {},
        }});
    });
    await page.route('**/api/investment/realtime-quotes?*', route => route.fulfill({json: {success: true, quotes: []}}));
    await page.route('**/api/market-session/us-equity?*', route => route.fulfill({json: {success: true, session: 'off', is_trading_day: false, is_realtime_allowed: false, trading_days: []}}));
    await page.goto('/trade/investment?view=holdings');
};

test('missing FX with mixed P&L coverage withholds Holdings and Metrics totals', async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await loadHoldings(page);
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings).toContainText('Partial · total unavailable');
    await expect(holdings.locator('[data-pnl-coverage]')).toHaveAttribute('data-pnl-coverage', 'partial');
    await expect(holdings.locator('[data-pnl-coverage]')).toHaveAttribute('title', /5.HK/);
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_cash_equivalents"]')).toHaveText('-');
    await page.goto('/trade/investment?view=metrics');
    await expect(page.locator('#investment_metrics_panel')).toContainText('Partial · total unavailable');
    expect(errors).toEqual([]);
});

test('missing cash FX cannot use an older numeric balance or equity', async ({page}) => {
    await loadHoldings(page, {foreignCash: true});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('-');
});

test('available FX restores complete Holdings valuation', async ({page}) => {
    await loadHoldings(page, {fx: {HKD: {dates: ['2026-01-02'], values: {'2026-01-02': 10}}}});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('10,110.00');
    await expect(holdings).not.toContainText('Partial · total unavailable');
});

test('missing interest FX invalidates P&L even when every stock is calculable', async ({page}) => {
    await loadHoldings(page, {foreignCash: true, cashType: 'credit_interest'});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings).toContainText('Partial · total unavailable');
    await expect(holdings.locator('[data-pnl-coverage]')).toHaveAttribute('title', 'Cash-flow FX unavailable');
});

for (const width of [894, 869, 390]) {
    test(`partial Holdings totals stay within their columns at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 844});
        await loadHoldings(page, {foreignCash: true, cashType: 'credit_interest'});
        const holdings = page.locator('#investment_holdings_panel');
        const marketValue = holdings.locator('[data-investment-live-field="summary_market_value"]');
        await expect(marketValue).toHaveText('1,100.00');
        for (const field of ['summary_realized_pnl', 'summary_cumulative_pnl']) {
            await expect(holdings.locator(`[data-investment-live-field="${field}"]`))
                .toHaveText('Partial · total unavailable');
        }
        await page.evaluate(() => document.fonts.ready);

        const measureLayout = () => holdings.evaluate((panel) => {
            const shell = panel.querySelector('.investment-holdings-table-shell');
            const scroller = shell.querySelector('[data-table-scroll]');
            const header = shell.querySelector('[data-table-header]');
            const body = scroller.querySelector('[data-table-body]');
            const bounds = (node) => {
                const {left, right, top, bottom} = node.getBoundingClientRect();
                return {left, right, top, bottom};
            };
            const textBounds = (node) => {
                const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
                const rectangles = [];
                while (walker.nextNode()) {
                    if (!walker.currentNode.textContent.trim()) continue;
                    const range = document.createRange();
                    range.selectNodeContents(walker.currentNode);
                    rectangles.push(...[...range.getClientRects()].map((rect) => ({
                        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                    })));
                }
                return rectangles;
            };
            const market = header.querySelector('[data-investment-live-field="summary_market_value"]');
            const statuses = [...header.querySelectorAll(
                '[data-investment-live-field$="_pnl"]:not([data-investment-live-number])',
            )].map((node) => {
                const grid = node.closest('.investment-holdings-summary-metrics');
                const label = node.closest('.investment-holdings-summary-metric-row')
                    ?.querySelector('.investment-holdings-summary-metric-label');
                return {
                    field: node.dataset.investmentLiveField,
                    cell: bounds(node.closest('td')),
                    grid: grid ? bounds(grid) : null,
                    compact: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length < 3 : false,
                    gridColumn: getComputedStyle(node).gridColumn,
                    label: label ? bounds(label) : null,
                    text: textBounds(node),
                };
            });
            const headerCells = [...header.tHead.rows[0].cells];
            const bodyCells = [...body.tBodies[0].rows[0].cells];
            const scrollerStyle = getComputedStyle(scroller);
            const borderRight = Number.parseFloat(scrollerStyle.borderRightWidth) || 0;
            const borderLeft = Number.parseFloat(scrollerStyle.borderLeftWidth) || 0;
            return {
                panel: bounds(panel), shell: bounds(shell), scroller: bounds(scroller),
                viewport: innerWidth,
                scrollbar: Math.max(0, scroller.offsetWidth - scroller.clientWidth),
                rightGutter: Math.max(0, scroller.offsetWidth - scroller.clientWidth - borderLeft - borderRight),
                contentRight: scroller.getBoundingClientRect().right - borderRight,
                contentLeft: scroller.getBoundingClientRect().left + borderLeft,
                columns: headerCells.map((cell, index) => ({
                    header: bounds(cell), body: bounds(bodyCells[index]),
                })),
                statuses,
                market: {cell: bounds(market.closest('td')), text: textBounds(market)},
            };
        });
        const assertContainedText = (rectangles, container, label) => {
            expect(rectangles.length, `${label} has rendered text`).toBeGreaterThan(0);
            rectangles.forEach((rect) => {
                expect(rect.left, `${label} left edge`).toBeGreaterThanOrEqual(container.left - 1);
                expect(rect.right, `${label} right edge`).toBeLessThanOrEqual(container.right + 1);
                expect(rect.top, `${label} top edge`).toBeGreaterThanOrEqual(container.top - 1);
                expect(rect.bottom, `${label} bottom edge`).toBeLessThanOrEqual(container.bottom + 1);
            });
        };
        const assertLayout = (layout) => {
            expect(layout.shell.left).toBeGreaterThanOrEqual(layout.panel.left - 1);
            expect(layout.shell.right).toBeLessThanOrEqual(layout.panel.right + 1);
            expect(layout.panel.left).toBeGreaterThanOrEqual(-1);
            expect(layout.panel.right).toBeLessThanOrEqual(layout.viewport + 1);
            expect(layout.scroller.left).toBeGreaterThanOrEqual(layout.shell.left - 1);
            expect(layout.scroller.right).toBeLessThanOrEqual(layout.shell.right + 1);
            expect(layout.columns).toHaveLength(9);
            layout.columns.forEach((column, index) => {
                expect(Math.abs(column.header.left - column.body.left), `column ${index} left alignment`)
                    .toBeLessThanOrEqual(2);
                expect(Math.abs(column.header.right - column.body.right), `column ${index} right alignment`)
                    .toBeLessThanOrEqual(index === layout.columns.length - 1 ? layout.scrollbar + 2 : 2);
            });
            expect(layout.statuses.length).toBeGreaterThanOrEqual(2);
            layout.statuses.forEach((status) => {
                assertContainedText(status.text, status.cell, status.field);
                if (status.grid) assertContainedText(status.text, status.grid, `${status.field} grid`);
                if (status.compact && status.field === 'summary_cumulative_pnl') {
                    expect(status.gridColumn, 'compact Cumulative P&L spans the summary width').toBe('1 / -1');
                }
                status.text.forEach((rect) => {
                    if (status.label) {
                        const overlapWidth = Math.min(rect.right, status.label.right) - Math.max(rect.left, status.label.left);
                        const overlapHeight = Math.min(rect.bottom, status.label.bottom) - Math.max(rect.top, status.label.top);
                        expect(overlapWidth > 1 && overlapHeight > 1, `${status.field} overlaps its label`).toBe(false);
                    }
                    layout.market.text.forEach((marketRect) => {
                        const overlapWidth = Math.min(rect.right, marketRect.right) - Math.max(rect.left, marketRect.left);
                        const overlapHeight = Math.min(rect.bottom, marketRect.bottom) - Math.max(rect.top, marketRect.top);
                        expect(overlapWidth > 1 && overlapHeight > 1, `${status.field} overlaps Market value`).toBe(false);
                    });
                });
            });
            assertContainedText(layout.market.text, layout.market.cell, 'numeric Market value');
        };

        await expect.poll(async () => {
            const layout = await measureLayout();
            return Math.max(...layout.columns.map((column) => Math.abs(column.header.left - column.body.left)));
        }).toBeLessThanOrEqual(2);
        const initial = await measureLayout();
        assertLayout(initial);
        await holdings.locator('[data-table-scroll]').evaluate((node) => {
            node.scrollLeft = node.scrollWidth;
        });
        await expect.poll(async () => {
            const layout = await measureLayout();
            return Math.max(...layout.columns.map((column) => Math.abs(column.header.left - column.body.left)));
        }).toBeLessThanOrEqual(2);
        const scrolled = await measureLayout();
        const lastColumn = scrolled.columns[scrolled.columns.length - 1].body;
        expect(lastColumn.left, 'the entire rightmost column is reachable')
            .toBeGreaterThanOrEqual(scrolled.contentLeft - 1);
        expect(lastColumn.right, 'the rightmost column stays inside the scroller')
            .toBeLessThanOrEqual(scrolled.contentRight + 1);
        // Chromium can subtract a reserved stable gutter from clientWidth while
        // its horizontal scroll limit uses the full inner width. Check geometry.
        expect(Math.min(
            Math.abs(lastColumn.right - scrolled.contentRight),
            Math.abs(lastColumn.right - (scrolled.contentRight - scrolled.rightGutter)),
        ), 'the rightmost column reaches the visible content edge').toBeLessThanOrEqual(1);
        assertLayout(scrolled);
        await expect(marketValue).toHaveText('1,100.00');
    });
}

test('initial Holdings preserves dated interest accrual without realtime quotes', async ({page}) => {
    await loadAccrualHoldings(page);
    const holdings = page.locator('#investment_holdings_panel');
    const cash = Number(await holdings.locator('[data-investment-live-field="summary_cash_balance"]').getAttribute('data-investment-live-number'));
    const marketValue = Number(await holdings.locator('[data-investment-live-field="summary_market_value"]').getAttribute('data-investment-live-number'));
    const totalEquity = Number(await holdings.locator('[data-investment-live-field="summary_total_equity"]').getAttribute('data-investment-live-number'));
    expect(totalEquity).toBeCloseTo(cash + marketValue - 6.5, 8);
    const metricsTotalEquity = Number(await page.locator('#investment_metrics_panel [data-investment-live-field="metrics_total_equity"]').getAttribute('data-investment-live-number'));
    expect(metricsTotalEquity).toBeCloseTo(totalEquity, 8);
});

test('initial Holdings fails current NAV closed when accrual FX is missing', async ({page}) => {
    await loadAccrualHoldings(page, {currency: 'HKD'});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).not.toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_market_value"]')).not.toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('-');
    await expect(page.locator('#investment_metrics_panel [data-investment-live-field="metrics_total_equity"]')).toHaveText('-');
});
