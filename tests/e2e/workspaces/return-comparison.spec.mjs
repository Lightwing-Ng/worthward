/* Return comparison regressions. Code version: v1.2.2 */
import {expect, test} from '@playwright/test';


test('restores Return comparison tickers from local memory', async ({page}) => {
    const memoryKey = 'worthward:return-comparison-tickers:v1';
    await page.goto('/settings/about');
    await page.evaluate((key) => {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem('worthward:view-memory');
    }, memoryKey);

    await page.goto('/workspaces/compare?ticker=AAPL&ticker=MSFT&period=1y');
    await expect(page.locator('#ticker_1')).toHaveValue('AAPL');
    await expect(page.locator('#ticker_2')).toHaveValue('MSFT');
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), memoryKey))
        .toBe('["AAPL","MSFT"]');

    await page.evaluate(() => window.sessionStorage.removeItem('worthward:view-memory'));
    await page.goto('/settings/about');
    await page.goto('/workspaces/compare');

    await expect(page).toHaveURL(/\/workspaces\/compare\?ticker=AAPL&ticker=MSFT/);
    await expect(page.locator('#ticker_1')).toHaveValue('AAPL');
    await expect(page.locator('#ticker_2')).toHaveValue('MSFT');
});


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


test('uses date-only, collision-aware labels on a one-year Return comparison axis', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1y');

    const axis = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'chart-wrap';
        host.style.width = '760px';
        host.style.height = '320px';
        const canvas = document.createElement('canvas');
        canvas.id = 'returnsChartAxisRegression';
        host.appendChild(canvas);
        document.body.appendChild(host);
        window.history.replaceState({}, '', '/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1y');

        const start = Date.UTC(2025, 8, 23);
        const rawDates = Array.from({length: 366}, (_, index) => (
            `${new Date(start + (index * 86_400_000)).toISOString().slice(0, 10)} 00:00`
        ));
        const series = ['QQQI', 'JEPQ'].map((ticker, index) => ({
            ticker,
            dates: rawDates,
            raw_dates: rawDates,
            normalized_returns: rawDates.map((_date, dateIndex) => dateIndex / 30 + index),
            color: index ? '#ff2f92' : '#0055cc',
            glow: false,
        }));
        const chart = window.WORTHWARD_BOOTSTRAP.renderReturnsChart({canvas}, {
            state: {
                currentView: 'tickers',
                chart: {series, profiles: []},
                theme: {muted: '#aaa', accent_primary: '#0055cc'},
                chartConfig: {},
            },
        });
        const plugin = chart.config._config.plugins.find((item) => item.id === 'xAxisLabelPlugin');
        const calls = [];
        plugin.afterDraw({
            canvas,
            width: chart.width,
            chartArea: chart.chartArea,
            scales: chart.scales,
            ctx: {
                save: () => {},
                restore: () => {},
                measureText: (text) => ({width: String(text).length * 7}),
                fillText(text, x) {
                    calls.push({text: String(text), x, align: this.textAlign});
                },
            },
        });
        const ticks = [...new Map(calls.map((call) => [call.x, call.align])).entries()]
            .map(([x, align]) => ({x, align}));
        return {labels: calls.map((call) => call.text), ticks};
    });

    expect(axis.labels.join(' ')).not.toMatch(/\d{2}:\d{2}/);
    expect(axis.labels).toContain('2025');
    expect(axis.labels).toContain('2026');
    expect(axis.ticks.length).toBeGreaterThanOrEqual(5);
    expect(axis.ticks.length).toBeLessThanOrEqual(12);
    expect(axis.ticks[0].align).toBe('left');
    expect(axis.ticks.at(-1).align).toBe('right');
    expect(axis.ticks.slice(1, -1).every((tick) => tick.align === 'center')).toBe(true);
});


test('keeps meaningful session times on an exact one-day Return comparison axis', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1d&range=exact&trading_date=2026-07-17');

    const axisLabels = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'chart-wrap';
        host.style.width = '760px';
        host.style.height = '320px';
        const canvas = document.createElement('canvas');
        canvas.id = 'returnsChartOneDayAxisRegression';
        host.appendChild(canvas);
        document.body.appendChild(host);
        window.history.replaceState({}, '', '/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1d&range=exact&trading_date=2026-07-17');

        const rawDates = [
            '2026-07-17 09:30',
            '2026-07-17 12:00',
            '2026-07-17 14:00',
            '2026-07-17 15:59',
        ];
        const series = ['QQQI', 'JEPQ'].map((ticker, index) => ({
            ticker,
            dates: rawDates,
            raw_dates: rawDates,
            normalized_returns: rawDates.map((_date, pointIndex) => pointIndex + index),
            color: index ? '#ff2f92' : '#0055cc',
            glow: false,
        }));
        const chart = window.WORTHWARD_BOOTSTRAP.renderReturnsChart({canvas}, {
            state: {
                currentView: 'tickers',
                chart: {series, profiles: [], tradingDate: '2026-07-17'},
                theme: {muted: '#aaa', accent_primary: '#0055cc'},
                chartConfig: {},
            },
        });
        const plugin = chart.config._config.plugins.find((item) => item.id === 'xAxisLabelPlugin');
        const calls = [];
        plugin.afterDraw({
            canvas,
            width: chart.width,
            chartArea: chart.chartArea,
            scales: chart.scales,
            ctx: {
                save: () => {},
                restore: () => {},
                fillText: (text) => calls.push(String(text)),
            },
        });
        return calls;
    });

    expect(axisLabels.filter((label) => /^\d{2}:\d{2}$/.test(label)))
        .toEqual(['09:30', '12:00', '14:00', '16:00']);
    expect(axisLabels).not.toContain('00:00');
    expect(axisLabels.filter((label) => label.includes('2026'))).toHaveLength(4);
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
