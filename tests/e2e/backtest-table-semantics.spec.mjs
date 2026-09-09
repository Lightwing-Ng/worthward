/* Code version: v1.0.1 */
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
