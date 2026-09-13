/* Code version: v1.0.3 */
import {expect, test} from '@playwright/test';

const BACKTEST_URL = [
    '/workspaces/backtest?range=3y',
    'strategy=leveraged-rotation',
    'show_trade_details=1',
    'initial_primary_pct=53.93',
    'initial_leveraged_pct=17.15',
    'primary_min_pct=13',
    'primary_max_pct=68',
    'leveraged_min_pct=17',
    'leveraged_max_pct=67',
    'buy_leveraged_drop_pct=5.00',
    'sell_leveraged_rise_pct=15.00',
].join('&');

const readHorizontalCenterDelta = (locator) => locator.evaluate((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const textBounds = range.getBoundingClientRect();
    const cellBounds = cell.getBoundingClientRect();
    return Math.abs(
        (textBounds.left + (textBounds.width / 2))
        - (cellBounds.left + (cellBounds.width / 2)),
    );
});

const collapseGlobalSidebar = async (page) => {
    const toggle = page.locator('#sidebar_toggle');
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.app-shell').evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations({subtree: true}).map((animation) => animation.finished));
    });
};

test('wraps standard headers and centers Backtest date-time and ticker cells', async ({page}) => {
    test.setTimeout(180_000);
    await page.setViewportSize({width: 1014, height: 1388});
    await page.goto(BACKTEST_URL);

    const shell = page.locator('#backtest_history_table_wrap');
    const headerTable = shell.locator(':scope > [data-table-header]');
    const wrappedHeader = headerTable.locator('th[data-markdown-export-label="Unrealized P&L"]');
    const dateCell = shell.locator('tbody .trade-transactions-date').first();
    const tickerCell = shell.locator('tbody .trade-transactions-ticker').first();

    await expect(shell).toBeVisible();
    await expect(wrappedHeader).toBeVisible();
    await expect(dateCell).toBeVisible();
    await expect(tickerCell).toBeVisible();

    const assertTableSemantics = async () => {
        await expect.poll(() => wrappedHeader.evaluate((cell) => {
            const range = document.createRange();
            range.selectNodeContents(cell);
            return {
                lineCount: range.getClientRects().length,
                whiteSpace: getComputedStyle(cell).whiteSpace,
            };
        })).toEqual({lineCount: 2, whiteSpace: 'normal'});

        await expect.poll(() => shell.evaluate((element) => {
            const header = element.querySelector(':scope > [data-table-header]');
            const scrollContainer = element.querySelector(':scope > [data-table-scroll]');
            const shellBounds = element.getBoundingClientRect();
            const declaredHeaderHeight = Number.parseFloat(
                getComputedStyle(element).getPropertyValue('--scrollable-data-table-header-height'),
            );
            return {
                declaredHeaderHeight,
                renderedHeaderHeight: header.getBoundingClientRect().height,
                scrollStartOffset: scrollContainer.getBoundingClientRect().top - shellBounds.top,
            };
        })).toEqual(expect.objectContaining({
            declaredHeaderHeight: expect.any(Number),
            renderedHeaderHeight: expect.any(Number),
            scrollStartOffset: expect.any(Number),
        }));

        const heightState = await shell.evaluate((element) => {
            const header = element.querySelector(':scope > [data-table-header]');
            const scrollContainer = element.querySelector(':scope > [data-table-scroll]');
            const shellBounds = element.getBoundingClientRect();
            return {
                declaredHeaderHeight: Number.parseFloat(
                    getComputedStyle(element).getPropertyValue('--scrollable-data-table-header-height'),
                ),
                renderedHeaderHeight: header.getBoundingClientRect().height,
                scrollStartOffset: scrollContainer.getBoundingClientRect().top - shellBounds.top,
            };
        });
        expect(heightState.renderedHeaderHeight).toBeGreaterThan(28);
        expect(Math.abs(heightState.declaredHeaderHeight - heightState.renderedHeaderHeight)).toBeLessThanOrEqual(1);
        expect(Math.abs(heightState.scrollStartOffset - heightState.renderedHeaderHeight)).toBeLessThanOrEqual(1);

        await expect(dateCell).toHaveCSS('text-align', 'center');
        await expect(tickerCell).toHaveCSS('text-align', 'center');
        expect(await readHorizontalCenterDelta(dateCell)).toBeLessThanOrEqual(1);
        expect(await readHorizontalCenterDelta(tickerCell)).toBeLessThanOrEqual(1);
    };

    await assertTableSemantics();
    await page.setViewportSize({width: 390, height: 844});
    await assertTableSemantics();
});

test('fills common wide result surfaces with complete integer percentage columns', async ({page}) => {
    test.setTimeout(180_000);
    const layouts = [
        {
            viewport: {width: 1125, height: 1349},
            url: '/workspaces/backtest?show_trade_details=1&initial_holding=100&quantity=5&rise=5.00&fall=2.00',
            expected: [5, 12, 6, 8, 8, 12, 12, 10, 15, 12],
        },
        {
            viewport: {width: 1011, height: 863},
            url: '/workspaces/backtest?show_trade_details=1&initial_holding=100&quantity=5&rise=5.00&fall=2.00',
            expected: [5, 12, 6, 8, 8, 12, 12, 10, 15, 12],
        },
        {
            viewport: {width: 1014, height: 1388},
            url: BACKTEST_URL,
            expected: [5, 12, 8, 5, 8, 8, 10, 10, 10, 12, 12],
        },
    ];
    const propertyNames = [
        '--backtest-col-no-width',
        '--backtest-col-date-time-width',
        '--backtest-col-ticker-width',
        '--backtest-col-side-width',
        '--backtest-col-price-width',
        '--backtest-col-quantity-width',
        '--backtest-col-realized-pnl-width',
        '--backtest-col-unrealized-pnl-width',
        '--backtest-col-cash-width',
        '--backtest-col-market-value-width',
        '--backtest-col-equity-width',
    ];

    for (const layout of layouts) {
        await page.setViewportSize(layout.viewport);
        await page.goto(layout.url);
        await collapseGlobalSidebar(page);
        const shell = page.locator('#backtest_history_table_wrap');
        const firstRow = shell.locator('[data-table-body] tbody tr').first();
        await expect(shell).toBeVisible();
        await expect(firstRow).toBeVisible();
        await expect.poll(() => shell.evaluate((element) => {
            const scroll = element.querySelector('[data-table-scroll]');
            return scroll.scrollWidth - scroll.clientWidth;
        })).toBeLessThanOrEqual(1);

        const geometry = await shell.evaluate((element, names) => {
            const scroll = element.querySelector('[data-table-scroll]');
            const table = element.querySelector('[data-table-body]');
            const row = table.querySelector('tbody tr');
            const tableWidth = table.getBoundingClientRect().width;
            const style = getComputedStyle(table);
            const applicableNames = row.cells.length === 10
                ? names.filter((name) => name !== '--backtest-col-ticker-width')
                : names;
            return {
                clientWidth: scroll.clientWidth,
                scrollWidth: scroll.scrollWidth,
                tableWidth,
                percentages: applicableNames
                    .map((name) => Number.parseFloat(style.getPropertyValue(name)))
                    .filter(Number.isFinite),
                columnPercentages: Array.from(row.cells).map((cell) => (
                    cell.getBoundingClientRect().width / tableWidth * 100
                )),
            };
        }, propertyNames);

        expect(geometry.percentages).toEqual(layout.expected);
        expect(geometry.percentages.reduce((sum, value) => sum + value, 0)).toBe(100);
        expect(geometry.percentages.every((value) => value % 2 === 0 || value % 5 === 0)).toBe(true);
        expect(geometry.scrollWidth - geometry.clientWidth).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.tableWidth - geometry.clientWidth)).toBeLessThanOrEqual(2);
        geometry.columnPercentages.forEach((value, index) => {
            expect(Math.abs(value - layout.expected[index])).toBeLessThanOrEqual(0.5);
        });
    }

    await page.setViewportSize({width: 390, height: 844});
    await page.goto(layouts[0].url);
    await collapseGlobalSidebar(page);
    const narrowShell = page.locator('#backtest_history_table_wrap');
    await expect(narrowShell.locator('[data-table-body] tbody tr').first()).toBeVisible();
    const narrowGeometry = await narrowShell.evaluate((element) => {
        const scroll = element.querySelector('[data-table-scroll]');
        const table = element.querySelector('[data-table-body]');
        return {
            clientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
            tableWidth: table.getBoundingClientRect().width,
        };
    });
    expect(narrowGeometry.tableWidth).toBeGreaterThanOrEqual(720);
    expect(narrowGeometry.scrollWidth).toBeGreaterThan(narrowGeometry.clientWidth);
});
