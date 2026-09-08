/* Return comparison regressions. Code version: v1.0.0 */
import {expect, test} from '@playwright/test';


test('exposes Return comparison title and result landmarks', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');

    await expect(page.getByRole('heading', {name: 'Return comparison', exact: true, level: 2})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Performance summary', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('.workspace-mode-shell')).toHaveAttribute(
        'aria-labelledby',
        'return_comparison_heading',
    );
    await expect(page.locator('.workspace-mode-controls-surface')).toHaveAttribute(
        'aria-labelledby',
        'return_comparison_heading',
    );
    await expect(page.locator('.workspace-mode-main')).toHaveAttribute(
        'aria-labelledby',
        'return_performance_heading',
    );
});


test('starts and stops Return comparison live refresh after same-page hydration', async ({page}) => {
    const liveRequests = [];
    let currentComparisonDate = '';
    await page.route('**/api/compare/live?*', async (route) => {
        const requestUrl = new URL(route.request().url());
        liveRequests.push(requestUrl);
        const tickers = requestUrl.searchParams.getAll('ticker');
        const period = requestUrl.searchParams.get('period') || '1d';
        const axisDate = requestUrl.searchParams.get('axis_date') || '';
        const liveDate = requestUrl.searchParams.get('live_date') || currentComparisonDate;
        const rawDates = [`${liveDate} 09:30`, `${liveDate} 09:31`];
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                period,
                axisDate,
                currentComparisonDate,
                liveDate,
                liveSessionActive: false,
                displayRange: '8 Sep 2026',
                series: tickers.map((ticker, index) => ({
                    ticker,
                    dates: rawDates,
                    raw_dates: rawDates,
                    prices: [100 + index, 101 + index],
                    normalized_returns: [0, 1],
                    candlestick_prices: [],
                    candlestick_returns: [],
                    color: index === 0 ? '#0055cc' : '#ff2f92',
                    glow: false,
                })),
                performanceItems: tickers.map((ticker, index) => ({
                    ticker,
                    ending_return: index,
                    ttm_dividend_yield: null,
                    color: index === 0 ? '#0055cc' : '#ff2f92',
                    is_winner: index === tickers.length - 1,
                    is_dividend_yield_winner: false,
                })),
                sources: Object.fromEntries(tickers.map((ticker) => [ticker, 'test'])),
                fetchedAt: `${currentComparisonDate}T00:00:00Z`,
            }),
        });
    });

    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    currentComparisonDate = await page.evaluate(() => window.WORTHWARD_APP?.comparisonCurrentDate || '');
    expect(currentComparisonDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await page.waitForTimeout(1_700);
    expect(liveRequests).toHaveLength(0);

    await page.locator('#period').evaluate((select) => {
        select.value = '1d';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page).toHaveURL(/range=1d/, {timeout: 30_000});
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect.poll(() => liveRequests.length, {timeout: 10_000}).toBe(1);
    expect(liveRequests[0].searchParams.get('period')).toBe('1d');
    expect(liveRequests[0].searchParams.has('live_date')).toBe(false);

    await page.evaluate(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('range', '1y');
        url.searchParams.delete('period');
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
        window.WORTHWARD_BOOTSTRAP.syncCompareLiveRefresh();
    });
    const requestCountAfterStop = liveRequests.length;
    await page.waitForTimeout(1_700);
    expect(liveRequests).toHaveLength(requestCountAfterStop);
});
