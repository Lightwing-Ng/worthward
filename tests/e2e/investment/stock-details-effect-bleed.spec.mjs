/* Code version: v1.1.2
 * The inline Holdings share drawer follows its owning row.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis, setSidebarExpanded} from '../critical_flows/support.mjs';

const mockStockDetails = async (page, extraTickers = []) => {
    await mockInvestmentReadApis(page, {
        startingCash: 1000,
        brokers: ['ibkr'],
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-02-02', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 20, amount: -200},
            {ledger_no: 2, broker: 'ibkr', date: '2026-02-02', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            ...extraTickers.map((ticker, index) => ({
                ledger_no: index + 3, broker: 'ibkr', date: '2026-02-02', type: 'buy',
                ticker, currency: 'USD', quantity: 1, price: 10, amount: -10,
            })),
        ],
        tickerProfiles: {
            DRAM: {ticker: 'DRAM', company_name: 'Roundhill Memory ETF'},
            AAPL: {ticker: 'AAPL', company_name: 'Apple Inc.'},
        },
        priceHistoryByTicker: {
            DRAM: [{date: '2026-02-02', close: 20}, {date: '2026-02-03', close: 21}],
            AAPL: [{date: '2026-02-02', close: 100}, {date: '2026-02-03', close: 101}],
        },
        intradayRows: () => [],
    });
};

for (const width of [390, 806, 1_024]) {
    test(`positions the stock share drawer inside the expanded Holdings row at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 1_000});
        await page.emulateMedia({reducedMotion: 'reduce'});
        await mockStockDetails(page);
        await page.goto('/trade/investment?view=holdings&ticker=DRAM&range=ytd');
        const row = page.locator('tr[data-investment-holding-detail="DRAM"]');
        const button = row.getByRole('button', {name: 'Export Transactions', exact: true});
        const chart = row.locator('.investment-stock-details-price-chart-card');
        const readBounds = (locator) => locator.evaluate((element) => element.getBoundingClientRect().toJSON());
        const expectHorizontalAlignment = () => expect.poll(() => button.evaluate((element) => {
            const anchor = document.querySelector('[data-layout-role="global-theme-anchor"]').getBoundingClientRect();
            const scroll = element.closest('.investment-holdings-table-scroll');
            const scrollRect = scroll.getBoundingClientRect();
            const content = element.closest('.investment-holding-detail-content').getBoundingClientRect();
            const buttonRect = element.getBoundingClientRect();
            const limit = Math.min(content.right, scrollRect.left + scroll.clientLeft + scroll.clientWidth);
            const alignedRight = anchor.left + (anchor.width + buttonRect.width) / 2;
            return Math.abs(buttonRect.right - Math.min(alignedRight, limit));
        })).toBeLessThanOrEqual(1);
        await expectHorizontalAlignment();
        await button.hover();
        await expectHorizontalAlignment();
        const [shareBounds, chartBounds] = await Promise.all([readBounds(button), readBounds(chart)]);
        expect(shareBounds.bottom).toBeLessThanOrEqual(chartBounds.top + 1);
        expect(shareBounds.right).toBeLessThanOrEqual(width);
        await expect(row.getByRole('button', {name: 'Mask Sensitive Values'})).toBeInViewport();
        await page.setViewportSize({width: width + 40, height: 1_000});
        await expectHorizontalAlignment();

        const ticker = page.locator('#investment_holdings_panel [data-table-scroll] [data-investment-stock-ticker="DRAM"]');
        await ticker.press('Enter');
        await expect(row).toHaveCount(0);
        await expect(page.locator('.investment-view-segmented-wrap > #investment_share_actions')).toBeVisible();
    });
}


test('keeps the Holdings table horizontally fitted when a ticker expands at 836px', async ({page}) => {
    await page.setViewportSize({width: 836, height: 1_403});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await mockStockDetails(page, [
        'QQQI', 'BOXX', 'GOOGL', 'META', 'SGOV', 'QQQ', 'SPY', 'MSFT', 'NVDA', 'EUV',
        'VOO', 'AMD', 'PLTR', 'INTC', 'BABA', 'AMZN', 'AMAT', 'ASML', 'ADBE', 'COST',
    ]);
    await page.goto('/trade/investment?view=holdings');
    await setSidebarExpanded(page, false);
    const scroll = page.locator('#investment_holdings_panel .investment-holdings-table-scroll');
    const ticker = scroll.locator('[data-investment-stock-ticker="DRAM"]');
    const expanded = scroll.locator('tr[data-investment-holding-detail="DRAM"]');
    const expectNoHorizontalOverflow = () => expect.poll(() => scroll.evaluate((element) => (
        element.scrollWidth - element.clientWidth
    ))).toBe(0);

    await expect(ticker).toBeVisible();
    await expect.poll(() => scroll.evaluate((element) => (
        element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(0);
    await expectNoHorizontalOverflow();
    const revealFrames = await ticker.evaluate((element) => {
        element.click();
        const detail = element.closest('tr').nextElementSibling;
        const reveal = detail.querySelector('.investment-holding-detail-reveal');
        return reveal.getAnimations()[0]?.effect.getKeyframes().map((frame) => frame.height);
    });
    expect(revealFrames).toEqual(['0px', expect.stringMatching(/^[1-9]\d*px$/)]);
    await expect(expanded.locator('.investment-stock-details-price-chart-canvas')).toBeInViewport();
    await expectNoHorizontalOverflow();
    await expanded.getByRole('button', {name: 'Export Transactions', exact: true}).hover();
    await expectNoHorizontalOverflow();
    await ticker.press('Enter');
    await expect(expanded).toHaveCount(0);
    await expectNoHorizontalOverflow();
});

test('shows a translucent frosted tooltip over the Holdings chart in Dark mode', async ({page}) => {
    await page.setViewportSize({width: 806, height: 1_180});
    await page.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'});
    await mockStockDetails(page);
    await page.goto('/trade/investment?view=holdings&ticker=DRAM&range=ytd');
    await setSidebarExpanded(page, false);
    const canvas = page.locator('#stock_panel .investment-stock-details-price-chart-canvas');
    await expect(canvas).toBeVisible();
    const size = await canvas.boundingBox();
    expect(size).not.toBeNull();
    await canvas.hover({position: {x: size.width / 2, y: size.height / 2}});
    const tooltip = page.locator('[data-investment-stock-details-tooltip="1"].is-visible');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.12)');
    await expect(tooltip).toHaveCSS('background-image', 'none');
    await expect(tooltip).toHaveCSS('backdrop-filter', 'saturate(1.6) blur(12px)');
});
