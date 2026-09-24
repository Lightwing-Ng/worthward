/* Code version: v1.0.0 */
import {expect, test, fulfillInertPriceLiveResponse} from './support.mjs';

const waitForPriceCharts = async (page) => {
    await page.waitForFunction(() => {
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        return canvases.length > 0 && canvases.every((canvas) => Boolean(window.Chart?.getChart?.(canvas)));
    });
};

const readRenderedDateAxis = async (page) => page.evaluate(() => {
    const canvas = document.querySelector('[data-price-subplot]:last-child [data-price-subplot-canvas]');
    const chart = window.Chart.getChart(canvas);
    const ctx = chart.ctx;
    const rendered = [];
    const originalFillText = ctx.fillText;
    try {
        ctx.fillText = function captureAxisText(value, x, y) {
            if (this.textBaseline === 'top' && y >= chart.chartArea.bottom - 1) {
                rendered.push({text: String(value), x, y});
            }
            return originalFillText.apply(this, arguments);
        };
        chart.draw();
    } finally {
        ctx.fillText = originalFillText;
    }
    const ticks = chart.$priceDateAxisTicks || [];
    return {
        canvasWidth: chart.width,
        chartBottom: chart.chartArea.bottom,
        tickCount: ticks.length,
        ticks: ticks.map(({index, x, align, left, right}) => ({index, x, align, left, right})),
        rendered,
        bodyScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
    };
});

test('uses the shared date axis and highlighted crosshair on Price comparison', async ({page}) => {
    await page.setViewportSize({width: 996, height: 801});
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1y');
    await waitForPriceCharts(page);
    await page.evaluate(() => document.fonts.ready);

    const desktopAxis = await readRenderedDateAxis(page);
    expect(desktopAxis.tickCount).toBeGreaterThan(2);
    expect(desktopAxis.tickCount).toBeLessThanOrEqual(12);
    expect(desktopAxis.ticks[0].align).toBe('left');
    expect(desktopAxis.ticks.at(-1).align).toBe('right');
    expect(desktopAxis.rendered).toHaveLength(desktopAxis.tickCount * 2);
    expect(desktopAxis.rendered.every(({text}) => !/\d{2}:\d{2}/.test(text))).toBe(true);
    expect(desktopAxis.ticks.every(({left, right}) => left >= 0 && right <= desktopAxis.canvasWidth)).toBe(true);
    expect(desktopAxis.ticks.slice(1).every((tick, index) => (
        tick.left - desktopAxis.ticks[index].right >= 48
    ))).toBe(true);
    const repeatedLayoutCalls = await page.evaluate(() => {
        const canvas = document.querySelector('[data-price-subplot]:last-child [data-price-subplot-canvas]');
        const chart = window.Chart.getChart(canvas);
        const before = chart.$priceDateAxisLayoutRuns;
        chart.draw();
        chart.draw();
        return chart.$priceDateAxisLayoutRuns - before;
    });
    expect(repeatedLayoutCalls).toBe(0);

    const target = await page.evaluate(() => {
        const canvas = document.querySelector('[data-price-subplot-canvas]');
        const chart = window.Chart.getChart(canvas);
        const prices = chart.data.datasets[0].data;
        const midpoint = Math.floor(prices.length / 2);
        const index = prices.findIndex((value, position) => position >= midpoint && Number.isFinite(value));
        if (index < 0) throw new Error('Price fixture has no valid midpoint.');
        const point = chart.getDatasetMeta(0).data[index];
        const rect = canvas.getBoundingClientRect();
        return {
            index,
            clientX: rect.left + (point.x * rect.width / chart.width),
            clientY: rect.top + (point.y * rect.height / chart.height),
        };
    });
    await page.mouse.move(target.clientX, target.clientY);
    const highlightedDate = page.locator('[data-price-subplot]:last-child [data-price-hover-date-label]');
    await expect(highlightedDate).toBeVisible();
    await expect(page.locator('.price-shared-tooltip')).toHaveClass(/is-visible/);
    const hover = await page.evaluate(() => {
        const firstCanvas = document.querySelector('[data-price-subplot-canvas]');
        const sourceChart = window.Chart.getChart(firstCanvas);
        const bottomCanvas = document.querySelector('[data-price-subplot]:last-child [data-price-subplot-canvas]');
        const bottomChart = window.Chart.getChart(bottomCanvas);
        const label = bottomCanvas.parentElement.querySelector('[data-price-hover-date-label]');
        const labelRect = label.getBoundingClientRect();
        const canvasRect = bottomCanvas.getBoundingClientRect();
        const guide = sourceChart.$priceHoverGuideBounds;
        const index = guide?.index;
        const expectedX = canvasRect.left + (
            bottomChart.scales.x.getPixelForValue(index) * canvasRect.width / bottomChart.width
        );
        const expectedTop = canvasRect.top + (
            bottomChart.chartArea.bottom * canvasRect.height / bottomChart.height
        );
        const price = sourceChart.data.datasets[0].data[index];
        const axisLines = window.WORTHWARD_BOOTSTRAP.dateDisplay.formatFullDateLines({
            year: Number(String(window.WORTHWARD_APP.chart.series[0].raw_dates[index]).slice(0, 4)),
            monthIndex: Number(String(window.WORTHWARD_APP.chart.series[0].raw_dates[index]).slice(5, 7)) - 1,
            day: Number(String(window.WORTHWARD_APP.chart.series[0].raw_dates[index]).slice(8, 10)),
        }, {allowWrap: true});
        return {
            lines: [...label.querySelectorAll('span')].map((span) => span.textContent),
            expectedLines: axisLines,
            centerX: labelRect.left + (labelRect.width / 2),
            expectedX,
            top: labelRect.top,
            expectedTop,
            guideY: guide?.y,
            expectedY: sourceChart.scales.y.getPixelForValue(price),
            guideValue: guide?.value,
            activeIndex: index,
            price,
            otherGuide: bottomChart.$priceHoverGuideBounds,
        };
    });
    expect(Number.isInteger(hover.activeIndex)).toBe(true);
    expect(hover.lines).toEqual(hover.expectedLines);
    expect(Math.abs(hover.centerX - hover.expectedX)).toBeLessThanOrEqual(2);
    expect(Math.abs(hover.top - hover.expectedTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(hover.guideY - hover.expectedY)).toBeLessThanOrEqual(0.5);
    expect(hover.guideValue).toBe(hover.price);
    expect(hover.otherGuide).toBeNull();

    const staticTickTarget = await page.evaluate(() => {
        const sourceCanvas = document.querySelector('[data-price-subplot-canvas]');
        const sourceChart = window.Chart.getChart(sourceCanvas);
        const bottomCanvas = document.querySelector('[data-price-subplot]:last-child [data-price-subplot-canvas]');
        const bottomChart = window.Chart.getChart(bottomCanvas);
        const tick = bottomChart.$priceDateAxisTicks.slice(1, -1)
            .find(({index}) => Number.isFinite(sourceChart.data.datasets[0].data[index]));
        if (!tick) throw new Error('Price fixture needs a valid interior date tick.');
        const point = sourceChart.getDatasetMeta(0).data[tick.index];
        const rect = sourceCanvas.getBoundingClientRect();
        return {
            axisX: tick.x,
            clientX: rect.left + (point.x * rect.width / sourceChart.width),
            clientY: rect.top + (point.y * rect.height / sourceChart.height),
        };
    });
    await page.mouse.move(staticTickTarget.clientX, staticTickTarget.clientY);
    await expect(highlightedDate).toBeVisible();
    const collisionAxis = await readRenderedDateAxis(page);
    expect(collisionAxis.rendered.length).toBeLessThan(collisionAxis.tickCount * 2);
    expect(collisionAxis.rendered.every(({x}) => Math.abs(x - staticTickTarget.axisX) > 0.5)).toBe(true);

    await page.mouse.move(25, 25);
    await expect(highlightedDate).toBeHidden();
    await expect.poll(() => page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => (
        window.Chart.getChart(canvas).$priceHoverGuideBounds
    ))).toBeNull();

    await page.setViewportSize({width: 390, height: 844});
    const narrowAxis = await readRenderedDateAxis(page);
    expect(narrowAxis.tickCount).toBeGreaterThanOrEqual(1);
    expect(narrowAxis.rendered).toHaveLength(narrowAxis.tickCount * 2);
    expect(narrowAxis.ticks.every(({left, right}) => left >= 0 && right <= narrowAxis.canvasWidth)).toBe(true);
    expect(narrowAxis.bodyScrollWidth).toBeLessThanOrEqual(narrowAxis.viewportWidth);
});

test('keeps short-range market times in the tooltip rather than Price axes', async ({page}) => {
    await page.route('**/api/compare/live?*', async (route) => {
        await fulfillInertPriceLiveResponse(route, ['DRAM', 'MU', 'STX']);
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await waitForPriceCharts(page);
    const axis = await readRenderedDateAxis(page);
    expect(axis.tickCount).toBeGreaterThanOrEqual(2);
    expect(axis.rendered.every(({text}) => !/\d{2}:\d{2}/.test(text))).toBe(true);

    const target = await page.evaluate(() => {
        const canvas = document.querySelector('[data-price-subplot-canvas]');
        const chart = window.Chart.getChart(canvas);
        const index = Math.floor(chart.data.labels.length / 2);
        const rect = canvas.getBoundingClientRect();
        return {
            x: rect.left + (chart.scales.x.getPixelForValue(index) * rect.width / chart.width),
            y: rect.top + ((chart.chartArea.top + chart.chartArea.bottom) * rect.height / (2 * chart.height)),
        };
    });
    await page.mouse.move(target.x, target.y);
    await expect(page.locator('.price-shared-tooltip .chart-tooltip-market-time').first()).toBeVisible();
    await expect(page.locator('[data-price-subplot]:last-child [data-price-hover-date-label]')).toBeVisible();
    const badgeText = await page.locator('[data-price-subplot]:last-child [data-price-hover-date-label]').innerText();
    expect(badgeText).not.toMatch(/\d{2}:\d{2}/);
});

test('keeps meaningful 1d Price time ticks on the shared axis', async ({page}) => {
    await page.route('**/api/compare/live?*', async (route) => {
        await fulfillInertPriceLiveResponse(route, ['DRAM', 'MU', 'STX']);
    });
    await page.setViewportSize({width: 996, height: 801});
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1d');
    await waitForPriceCharts(page);
    const desktopAxis = await readRenderedDateAxis(page);
    const desktopTimes = desktopAxis.rendered
        .filter(({y}) => Math.abs(y - desktopAxis.chartBottom) <= 0.5)
        .map(({text}) => text);
    expect(desktopAxis.tickCount).toBeGreaterThanOrEqual(2);
    expect(desktopAxis.tickCount).toBeLessThanOrEqual(12);
    expect(desktopTimes).toHaveLength(desktopAxis.tickCount);
    expect(desktopTimes.every((time) => /^\d{2}:\d{2}$/.test(time))).toBe(true);
    expect(desktopTimes.some((time) => time !== '00:00')).toBe(true);
    const displayedCount = await page.locator('[data-price-subplot]:last-child [data-price-subplot-canvas]')
        .getAttribute('data-single-day-time-labels');
    expect(Number(displayedCount)).toBe(desktopAxis.tickCount);

    const target = await page.evaluate(() => {
        const canvas = document.querySelector('[data-price-subplot-canvas]');
        const chart = window.Chart.getChart(canvas);
        const index = Math.floor(chart.data.labels.length / 2);
        const rect = canvas.getBoundingClientRect();
        return {
            x: rect.left + (chart.scales.x.getPixelForValue(index) * rect.width / chart.width),
            y: rect.top + ((chart.chartArea.top + chart.chartArea.bottom) * rect.height / (2 * chart.height)),
        };
    });
    await page.mouse.move(target.x, target.y);
    const badge = page.locator('[data-price-subplot]:last-child [data-price-hover-date-label]');
    await expect(badge).toBeVisible();
    expect(await badge.innerText()).not.toMatch(/\d{2}:\d{2}/);
    await expect(page.locator('.price-shared-tooltip .chart-tooltip-market-time').first()).toBeVisible();

    await page.mouse.move(25, 25);
    await page.setViewportSize({width: 390, height: 844});
    const narrowAxis = await readRenderedDateAxis(page);
    const narrowTimes = narrowAxis.rendered
        .filter(({y}) => Math.abs(y - narrowAxis.chartBottom) <= 0.5)
        .map(({text}) => text);
    expect(narrowAxis.tickCount).toBeGreaterThanOrEqual(2);
    expect(narrowTimes).toHaveLength(narrowAxis.tickCount);
    expect(narrowTimes.every((time) => /^\d{2}:\d{2}$/.test(time))).toBe(true);
    expect(narrowAxis.ticks.every(({left, right}) => left >= 0 && right <= narrowAxis.canvasWidth)).toBe(true);
    expect(narrowAxis.bodyScrollWidth).toBeLessThanOrEqual(narrowAxis.viewportWidth);
});
