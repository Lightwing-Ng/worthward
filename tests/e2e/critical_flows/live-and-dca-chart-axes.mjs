/* Code version: v1.0.0 */
import {expect, test} from './support.mjs';

const intradayRows = [
    {date: '2026-09-21 09:30', open: 100, high: 101, low: 99, close: 100.25},
    {date: '2026-09-21 10:30', open: 100.25, high: 101.5, low: 100, close: 101},
    {date: '2026-09-21 15:59', open: 101, high: 102, low: 100.5, close: 101.75},
    {date: '2026-09-22 09:30', open: 102, high: 103, low: 101.5, close: 102.5},
    {date: '2026-09-22 10:30', open: 102.5, high: 104, low: 102, close: 103.25},
    {date: '2026-09-22 15:59', open: 103.25, high: 104, low: 102.5, close: 103.5},
    {date: '2026-09-23 09:30', open: 104, high: 105, low: 103.5, close: 104.25},
    {date: '2026-09-23 10:30', open: 104.25, high: 106, low: 104, close: 105.5},
    {date: '2026-09-23 15:59', open: 105.5, high: 106, low: 105, close: 105.75},
];

const readChartPoint = (page, selector, ratio = 0.5) => page.evaluate(({selector, ratio}) => {
    const canvas = document.querySelector(selector);
    const chart = window.Chart?.getChart?.(canvas);
    const points = chart?.getDatasetMeta?.(0)?.data || [];
    const index = Math.floor((points.length - 1) * ratio);
    const point = points[index];
    const rect = canvas?.getBoundingClientRect();
    if (!chart || !point || !rect) return null;
    return {
        index,
        label: chart.data.labels[index],
        value: chart.data.datasets[0].data[index],
        x: rect.left + (point.x * rect.width / chart.width),
        y: rect.top + (point.y * rect.height / chart.height),
    };
}, {selector, ratio});

const captureChartDraw = (page, selector) => page.evaluate((selector) => {
    const chart = window.Chart?.getChart?.(document.querySelector(selector));
    if (!chart) return null;
    const ctx = chart.ctx;
    const texts = [];
    const segments = [];
    let pathSegments = [];
    let lastPoint = null;
    const originals = {
        beginPath: ctx.beginPath,
        moveTo: ctx.moveTo,
        lineTo: ctx.lineTo,
        stroke: ctx.stroke,
        fillText: ctx.fillText,
    };
    try {
        ctx.beginPath = function beginPath() {
            pathSegments = [];
            lastPoint = null;
            return originals.beginPath.apply(this, arguments);
        };
        ctx.moveTo = function moveTo(x, y) {
            lastPoint = {x, y};
            return originals.moveTo.apply(this, arguments);
        };
        ctx.lineTo = function lineTo(x, y) {
            if (lastPoint) pathSegments.push({from: lastPoint, to: {x, y}});
            lastPoint = {x, y};
            return originals.lineTo.apply(this, arguments);
        };
        ctx.stroke = function stroke() {
            segments.push(...pathSegments);
            return originals.stroke.apply(this, arguments);
        };
        ctx.fillText = function fillText(value, x, y) {
            texts.push({value: String(value), x, y});
            return originals.fillText.apply(this, arguments);
        };
        chart.draw();
    } finally {
        Object.assign(ctx, originals);
    }
    return {
        chartArea: {...chart.chartArea},
        width: chart.width,
        height: chart.height,
        texts,
        segments,
    };
}, selector);

const hasSegment = (segments, from, to) => segments.some((segment) => (
    Math.abs(segment.from.x - from.x) <= 0.75
    && Math.abs(segment.from.y - from.y) <= 0.75
    && Math.abs(segment.to.x - to.x) <= 0.75
    && Math.abs(segment.to.y - to.y) <= 0.75
));

test('live trading chart axes keep intraday minutes and clear both hover guides', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 900});
    const intradayRequests = [];
    const orderRequests = [];
    await page.route('**/api/live-trading/orders**', async (route) => {
        orderRequests.push(route.request().url());
        await route.abort();
    });
    await page.route('**/api/live-trading/positions**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({success: true, account_balances: [], positions: []}),
    }));
    await page.route('**/api/symbol-search**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{source: 'local', symbol: 'QQQ', name: 'Chart axis fixture', logo_url: ''}]),
    }));
    await page.route('**/api/investment/intraday?*', (route) => {
        const url = new URL(route.request().url());
        intradayRequests.push(url.searchParams.get('range'));
        return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                source: 'local',
                interval: '1m',
                rows: url.searchParams.get('range') === '3d'
                    ? intradayRows
                    : intradayRows.slice(-3),
            }),
        });
    });
    const unlock = await page.context().request.post('/trade/live-trading/unlock', {
        form: {pin: process.env.WORTHWARD_LIVE_TRADING_PIN || '123456'},
    });
    expect(unlock.status()).toBe(200);
    await page.goto('/trade/live-trading');
    await page.locator('#live_trading_ticker').fill('QQQ');
    await expect(page.locator('#live_trading_ticker_suggestions .suggestion-item').first()).toBeVisible();
    await page.locator('#live_trading_ticker_suggestions .suggestion-item').first().click();
    const canvas = page.locator('#live_trading_bars_canvas');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart?.(document.querySelector('#live_trading_bars_canvas'))?.data.labels.length || 0
    ))).toBe(3);

    for (const {range, count} of [{range: 'current-day', count: 3}, {range: '3d', count: 9}]) {
        if (range === '3d') {
            await page.locator('label[for="live_trading_range_3d"]').click();
            await expect.poll(() => page.evaluate(() => (
                window.Chart?.getChart?.(document.querySelector('#live_trading_bars_canvas'))?.data.labels.length || 0
            ))).toBe(count);
        }
        const draw = await captureChartDraw(page, '#live_trading_bars_canvas');
        const minutes = draw.texts.filter(({value, y}) => (
            /^\d{2}:\d{2}$/.test(value) && y >= draw.chartArea.bottom && y < draw.height
        ));
        expect(minutes.length).toBeGreaterThanOrEqual(2);
        expect(minutes.some(({value}) => value === '09:30')).toBe(true);
        await canvas.scrollIntoViewIfNeeded();
        const point = await readChartPoint(page, '#live_trading_bars_canvas', 0.5);
        expect(point).not.toBeNull();
        await page.mouse.move(point.x, point.y);
        const badge = page.locator('[data-live-trading-hover-date-label]');
        await expect(badge).toBeVisible();
        await expect(badge.locator('span').nth(1)).toHaveText(/^\d{2}:\d{2}$/);
        const hover = await page.evaluate(() => {
            const canvas = document.querySelector('#live_trading_bars_canvas');
            const chart = window.Chart?.getChart?.(canvas);
            const badge = document.querySelector('[data-live-trading-hover-date-label]');
            const guide = chart?._activeLiveTradingGuideBounds;
            const badgeRect = badge?.getBoundingClientRect();
            const canvasRect = canvas?.getBoundingClientRect();
            return {guide, badgeTop: badgeRect?.top, badgeCenterX: badgeRect ? (badgeRect.left + badgeRect.right) / 2 : null,
                expectedBadgeTop: chart && canvasRect
                    ? canvasRect.top + (chart.chartArea.bottom * canvasRect.height / chart.height) : null,
                expectedX: chart && guide && canvasRect
                    ? canvasRect.left + (guide.x * canvasRect.width / chart.width) : null};
        });
        expect(hover.guide?.index).toBe(point.index);
        expect(hover.guide?.price).toBe(point.value);
        expect(Number.isFinite(hover.guide?.badgeLeft)).toBe(true);
        expect(Math.abs(hover.badgeCenterX - hover.expectedX)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(hover.badgeTop - hover.expectedBadgeTop)).toBeLessThanOrEqual(1.5);
        const hoverDraw = await captureChartDraw(page, '#live_trading_bars_canvas');
        expect(hasSegment(hoverDraw.segments,
            {x: hover.guide.x, y: hoverDraw.chartArea.top},
            {x: hover.guide.x, y: hoverDraw.chartArea.bottom})).toBe(true);
        expect(hasSegment(hoverDraw.segments,
            {x: hoverDraw.chartArea.left, y: hover.guide.y},
            {x: hoverDraw.chartArea.right, y: hover.guide.y})).toBe(true);
        await page.mouse.move(1, 1);
        await expect(badge).toBeHidden();
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart?.(document.querySelector('#live_trading_bars_canvas'))
                ?._activeLiveTradingGuideBounds == null
        ))).toBe(true);
    }
    expect(intradayRequests).toEqual(expect.arrayContaining(['current-day', '3d']));
    expect(orderRequests).toHaveLength(0);
});

test('DCA price and equity axes share a date badge and clear the price crosshair', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=TQQQ&range=5y&strategy=dca&stop_loss=0&month_day=1');
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
        && window.Chart?.getChart?.(document.querySelector('#tradeEquityChart')),
    ))).toBe(true);
    const initialPrice = await captureChartDraw(page, '#tradePriceChart');
    const initialEquity = await captureChartDraw(page, '#tradeEquityChart');
    const dateLabels = (draw) => (
        draw.texts.filter(({value, y}) => (
            /^\d{1,2} [A-Z][a-z]{2}$/.test(value)
            && y >= draw.chartArea.bottom
            && y < draw.height
        ))
    );
    expect(dateLabels(initialPrice)).toHaveLength(0);
    expect(dateLabels(initialEquity).length).toBeGreaterThanOrEqual(2);
    const badge = page.locator('.trade-chart-stack > .trade-chart-hover-date-label');
    const hoverLine = page.locator('.trade-chart-stack > .trade-chart-hover-line');
    for (const {selector, ratio} of [
        {selector: '#tradePriceChart', ratio: 0.35},
        {selector: '#tradeEquityChart', ratio: 0.65},
    ]) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const point = await readChartPoint(page, selector, ratio);
        expect(point).not.toBeNull();
        await page.mouse.move(point.x, point.y);
        await expect(badge).toBeVisible();
        await expect(hoverLine).toHaveClass(/is-visible/);
        const hover = await page.evaluate(() => {
            const priceCanvas = document.querySelector('#tradePriceChart');
            const equityCanvas = document.querySelector('#tradeEquityChart');
            const priceChart = window.Chart?.getChart?.(priceCanvas);
            const equityChart = window.Chart?.getChart?.(equityCanvas);
            const badge = priceCanvas?.closest('.trade-chart-stack')?.querySelector('.trade-chart-hover-date-label');
            const line = priceCanvas?.closest('.trade-chart-stack')?.querySelector('.trade-chart-hover-line');
            const guide = priceChart?._activeDcaPriceGuideBounds;
            const badgeRect = badge?.getBoundingClientRect();
            const lineRect = line?.getBoundingClientRect();
            const equityRect = equityCanvas?.getBoundingClientRect();
            return {guide,
                badgeTop: badgeRect?.top,
                badgeCenterX: badgeRect ? (badgeRect.left + badgeRect.right) / 2 : null,
                lineCenterX: lineRect ? (lineRect.left + lineRect.right) / 2 : null,
                expectedBadgeTop: equityChart && equityRect
                    ? equityRect.top + (equityChart.chartArea.bottom * equityRect.height / equityChart.height) : null};
        });
        expect(hover.guide?.price).toBeGreaterThan(0);
        expect(Number.isFinite(hover.guide?.badgeLeft)).toBe(true);
        expect(Math.abs(hover.badgeCenterX - hover.lineCenterX)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(hover.badgeTop - hover.expectedBadgeTop)).toBeLessThanOrEqual(1.5);
        const priceDraw = await captureChartDraw(page, '#tradePriceChart');
        expect(hasSegment(priceDraw.segments,
            {x: priceDraw.chartArea.left, y: hover.guide.y},
            {x: priceDraw.chartArea.right, y: hover.guide.y})).toBe(true);
        await page.mouse.move(1, 1);
        await expect(badge).toBeHidden();
        await expect(hoverLine).not.toHaveClass(/is-visible/);
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
                ?._activeDcaPriceGuideBounds == null
        ))).toBe(true);
    }
});
