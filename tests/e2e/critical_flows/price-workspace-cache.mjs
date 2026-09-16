/* Code version: v1.0.2 */
import {
    expect,
    test,
    readFile,
    openBacktestParameterOverlay,
    fixturePath,
    requireChipFallback,
    setSidebarExpanded,
    tapAtCenter,
    readPriceLogoThemeAlignment,
    recordCostDistributionGuideStrokes,
    fulfillInertPriceLiveResponse,
    mockInvestmentReadApis,
    assertCompleteStandardInvestmentExportPayload,
} from './support.mjs';
test('reuses and narrows the cached chip payload when shortening Period', async ({page}) => {
    await requireChipFallback(page);
    let chipRequests = 0;
    const tickers = ['SPY', 'QQQ', 'MU', 'DRAM'];
    const start = Date.UTC(2024, 7, 26);
    const buildCachedOhlcv = (tickerIndex) => Array.from({length: 730}, (_, rowIndex) => {
        const close = 100 + (tickerIndex * 100) + (rowIndex * 0.3);
        const date = new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10);
        return {
            t: `${date} 00:00`,
            o: close - 1,
            h: close + 3,
            l: close - 3,
            c: close,
            v: 100_000 + ((rowIndex % 7) * 10_000),
            synthetic: false,
        };
    });
    await page.route('**/api/compare/chips**', async (route) => {
        chipRequests += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers.map((ticker, tickerIndex) => ({
                    ticker,
                    source: 'longbridge-daily-ohlcv',
                    ohlcv: buildCachedOhlcv(tickerIndex),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=SPY&ticker=QQQ&ticker=MU&ticker=DRAM&range=2y');
    await page.locator('label[for="show_chips"]').click();
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(4);
    expect(chipRequests).toBe(1);

    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    await expect(periodTrigger).toHaveAttribute('aria-label', 'Period: 2 years');
    await periodTrigger.click();
    await page.locator('#period_dropdown [role="option"][data-value="1y"]').click();
    await expect(periodTrigger).toHaveAttribute('aria-label', 'Period: 1 year');
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(4);
    await expect(page.locator('[data-chip-loading-spinner]:not([hidden])')).toHaveCount(0);
    expect(chipRequests).toBe(1);
});

test('ignores partial cached volume rows when loading the chip distribution', async ({page}) => {
    let fallbackRequests = 0;
    const start = Date.UTC(2026, 4, 1);
    const fallbackSeries = ['AAPL', 'QQQ', 'SPY', 'DRAM'].map((ticker, tickerIndex) => ({
        ticker,
        source: 'longbridge-daily-ohlcv',
        ohlcv: Array.from({length: 90}, (_, rowIndex) => {
            const close = 100 + (tickerIndex * 200) + (rowIndex * (0.7 + (tickerIndex * 0.08)));
            const timestamp = new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10);
            return {
                t: `${timestamp} 00:00`,
                o: close - 1.2,
                h: close + 3.4,
                l: close - 3.1,
                c: close,
                v: 100_000 + ((rowIndex % 9) * 15_000),
                synthetic: false,
            };
        }),
    }));
    await page.route('**/api/compare/chips**', async (route) => {
        fallbackRequests += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({success: true, series: fallbackSeries, errors: {}}),
        });
    });

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=QQQ&ticker=SPY&ticker=DRAM&period=1y');
    const partialRows = await page.evaluate(() => {
        window.WORTHWARD_APP.chart.series
            .filter((item) => ['QQQ', 'SPY'].includes(item.ticker))
            .forEach((item) => {
                item.ohlcv = item.ohlcv.map((row, rowIndex, rows) => ({
                    ...row,
                    v: rowIndex >= rows.length - 2 ? 100_000 : null,
                }));
            });
        return window.WORTHWARD_APP.chart.series
            .filter((item) => ['QQQ', 'SPY'].includes(item.ticker))
            .map((item) => item.ohlcv.filter((row) => Number(row.v) > 0).length);
    });
    expect(partialRows).toEqual([2, 2]);

    await page.locator('label[for="show_chips"]').click();
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(4);
    expect(fallbackRequests).toBe(1);

    const expectedPocs = await page.evaluate((series) => series.map((item) => ({
        ticker: item.ticker,
        poc: window.WORTHWARD_CHIP_DISTRIBUTION.calculateChipDistribution(item.ohlcv, {binCount: 100}).pocPrice,
    })), fallbackSeries);
    const actualPocs = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => ({
            ticker: canvas.closest('[data-price-subplot]')?.dataset.ticker,
            poc: Number(canvas.dataset.chipPocPrice),
        }))
    ));
    ['QQQ', 'SPY'].forEach((ticker) => {
        const actual = actualPocs.find((item) => item.ticker === ticker);
        const expected = expectedPocs.find((item) => item.ticker === ticker);
        expect(actual.poc).toBeCloseTo(expected.poc, 6);
    });
    expect(actualPocs.find((item) => item.ticker === 'QQQ').poc).toBeLessThan(700);
    expect(actualPocs.find((item) => item.ticker === 'SPY').poc).toBeLessThan(900);
});

test('loads range-bounded Longbridge OHLCV when a legacy price cache has no volume', async ({page}) => {
    let fallbackBounds = null;
    let fallbackRequests = 0;
    let releaseFallbackResponse;
    const fallbackResponseGate = new Promise((resolve) => {
        releaseFallbackResponse = resolve;
    });
    await page.route('**/api/compare/chips**', async (route) => {
        fallbackRequests += 1;
        const url = new URL(route.request().url());
        fallbackBounds = {from: url.searchParams.get('from'), to: url.searchParams.get('to')};
        const tickers = url.searchParams.getAll('ticker');
        const start = Date.UTC(2025, 7, 25);
        await fallbackResponseGate;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers.map((ticker, tickerIndex) => ({
                    ticker,
                    source: 'longbridge-daily-ohlcv',
                    ohlcv: Array.from({length: 90}, (_, rowIndex) => {
                        const close = 100 + (tickerIndex * 100) + (rowIndex * 0.5);
                        return {
                            t: `${new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10)} 00:00`,
                            o: close - 1,
                            h: close + 2,
                            l: close - 2,
                            c: close,
                            v: 100_000 + (rowIndex * 1_000),
                            synthetic: false,
                        };
                    }),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&ticker=MU&ticker=AMD&period=1y');
    const expectedBounds = await page.evaluate(() => {
        const rows = window.WORTHWARD_APP.chart.series.flatMap((item) => item.ohlcv || []);
        const dates = rows.map((row) => String(row.t).slice(0, 10)).sort();
        window.WORTHWARD_APP.chart.series.forEach((item) => {
            item.ohlcv = item.ohlcv.map((row) => ({...row, v: null}));
        });
        return {from: dates[0], to: dates[dates.length - 1]};
    });

    await page.locator('label[for="show_chips"]').click();
    await expect.poll(() => fallbackBounds).toEqual(expectedBounds);
    await expect(page.locator('[data-chip-loading-spinner]:not([hidden])')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot][aria-busy="true"]')).toHaveCount(4);
    await expect(page.locator('[data-chips-chart-status]')).toHaveAttribute('data-state', 'loading');
    await expect(page.locator('[data-chips-chart-status]')).toBeHidden();
    await expect(page.locator('[data-chips-chart-status]')).toBeEmpty();
    expect(fallbackRequests).toBe(1);
    releaseFallbackResponse();
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-bin-count="100"]')).toHaveCount(4);
    await expect(page.locator('[data-chip-loading-spinner][hidden]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot][aria-busy="false"]')).toHaveCount(4);
    await expect(page.locator('[data-chips-chart-status]')).toBeEmpty();
});

test('exposes turnover-survival metadata and dense cost ranges in the browser bundle', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&period=1y');

    const result = await page.evaluate(() => {
        const calculator = window.WORTHWARD_CHIP_DISTRIBUTION;
        const distribution = calculator.calculateChipDistribution([
            {t: '2026-08-20', o: 100, h: 100, l: 100, c: 100, v: 100},
            {t: '2026-08-21', o: 200, h: 200, l: 200, c: 200, v: 100},
        ], {binCount: 100, circulatingShares: 1_000});
        const statistics = calculator.calculateChipStatistics(distribution, 150);
        return {
            model: distribution.model,
            decayApplied: distribution.decayApplied,
            totalInputVolume: distribution.totalInputVolume,
            totalWeight: distribution.totalWeight,
            costRangeMethod: statistics.costRangeMethod,
        };
    });

    expect(result).toEqual({
        model: 'turnover-survival',
        decayApplied: true,
        totalInputVolume: 200,
        totalWeight: 190,
        costRangeMethod: 'shortest-contiguous-high-density',
    });
});

test('keeps the production chip panel on the complete selected-range volume profile', async ({page}) => {
    await requireChipFallback(page);
    await page.setViewportSize({width: 759, height: 1170});
    let chipRequests = 0;
    const tickers = ['QQQ', 'SPY'];
    const start = Date.UTC(2025, 7, 27);
    const buildOhlcv = (tickerIndex) => Array.from({length: 252}, (_, rowIndex) => {
        const close = 560 + (tickerIndex * 70) + (rowIndex * 0.72);
        return {
            t: `${new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10)} 00:00`,
            o: close - 1,
            h: close + 3,
            l: close - 3,
            c: close,
            v: 80_000_000,
            synthetic: false,
        };
    });
    await page.route('**/api/compare/chips**', async (route) => {
        chipRequests += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers.map((ticker, tickerIndex) => ({
                    ticker,
                    source: 'longbridge-daily-ohlcv',
                    circulatingShares: 1_000_000_000,
                    shareBasis: 'longbridge-static-circulating-shares',
                    ohlcv: buildOhlcv(tickerIndex),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=QQQ&ticker=SPY&range=1y&chips=1');
    await expect.poll(() => chipRequests).toBe(1);
    const canvases = page.locator('[data-price-subplot-canvas]');
    await expect(canvases).toHaveCount(2);
    await expect(canvases.first()).toHaveAttribute('data-chip-model', 'ohlcv-estimate');
    await expect(canvases.first()).toHaveAttribute('data-chip-decay-applied', '0');
    await expect(canvases.last()).toHaveAttribute('data-chip-model', 'ohlcv-estimate');
    await expect(canvases.last()).toHaveAttribute('data-chip-decay-applied', '0');
    const populatedBins = await canvases.evaluateAll((items) => (
        items.map((canvas) => Number(canvas.dataset.chipPopulatedBinCount))
    ));
    expect(populatedBins.every((count) => count === 100)).toBe(true);
    const renderedCoverage = await canvases.evaluateAll((items) => items.map((canvas) => {
        const chart = window.Chart.getChart(canvas);
        const distribution = chart.$costDistribution.distribution;
        const panelWidth = Math.max(0, chart.width - chart.chartArea.right - 18);
        const visibleBins = distribution.bins.filter((bin) => (
            bin.weight > 0 && (bin.normalizedWidth * panelWidth) >= 0.75
        ));
        const visibleSpan = visibleBins.length
            ? visibleBins[visibleBins.length - 1].high - visibleBins[0].low
            : 0;
        return visibleSpan / (distribution.maxPrice - distribution.minPrice);
    }));
    expect(renderedCoverage.every((coverage) => coverage >= 0.95)).toBe(true);

    const hoverPoint = await canvases.first().evaluate((canvas) => {
        const chart = window.Chart.getChart(canvas);
        const rect = canvas.getBoundingClientRect();
        const dataIndex = Math.floor((window.WORTHWARD_APP.chart.series[0].prices.length - 1) / 2);
        return {
            x: rect.left + (chart.scales.x.getPixelForValue(dataIndex) * (rect.width / chart.width)),
            y: rect.top + (chart.chartArea.top * (rect.height / chart.height)) + 8,
        };
    });
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-snapshot-mode="cumulative-hover"]')).toHaveCount(2);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-model="ohlcv-estimate"]')).toHaveCount(2);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-decay-applied="0"]')).toHaveCount(2);
});

test('keeps a range-wide chip profile when turnover reaches saturation', async ({page}) => {
    await requireChipFallback(page);
    let chipRequests = 0;
    const tickers = ['000660.KS', 'SKHY', 'DRAM'];
    const buildOhlcv = (tickerIndex, startDate, rowCount) => Array.from({length: rowCount}, (_, rowIndex) => {
        const base = [100, 200, 45][tickerIndex];
        const close = base + (rowIndex * 0.55);
        const date = new Date(Date.parse(`${startDate}T00:00:00Z`) + (rowIndex * 86_400_000))
            .toISOString()
            .slice(0, 10);
        return {
            t: `${date} 00:00`,
            o: close - 0.5,
            h: close + 1.5,
            l: close - 1.5,
            c: close,
            v: 110,
            synthetic: false,
        };
    });
    await page.route('**/api/compare/chips**', async (route) => {
        chipRequests += 1;
        const requestUrl = new URL(route.request().url());
        const startDate = requestUrl.searchParams.get('from') || '2026-04-14';
        const endDate = requestUrl.searchParams.get('to') || '2026-07-14';
        const rowCount = Math.floor((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
        expect(rowCount).toBeGreaterThan(20);
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers.map((ticker, tickerIndex) => ({
                    ticker,
                    source: 'longbridge-daily-ohlcv',
                    circulatingShares: 100,
                    shareBasis: 'longbridge-static-circulating-shares',
                    ohlcv: buildOhlcv(tickerIndex, startDate, rowCount),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=000660.KS&ticker=SKHY&ticker=DRAM&range=1mo&chips=1');
    const readChipState = () => page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => ({
            ticker: canvas.closest('[data-price-subplot]')?.dataset.ticker,
            source: canvas.dataset.chipSource,
            model: canvas.dataset.chipModel,
            populatedBins: Number(canvas.dataset.chipPopulatedBinCount),
        }))
    ));
    await expect.poll(async () => (await readChipState()).filter((item) => item.source === 'ohlcv-estimate')).toHaveLength(3);
    expect((await readChipState()).find((item) => item.ticker === 'DRAM')).toMatchObject({
        model: 'ohlcv-estimate',
    });
    expect((await readChipState()).find((item) => item.ticker === 'DRAM').populatedBins).toBeGreaterThan(10);

    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    await periodTrigger.click();
    await page.locator('#period_dropdown [role="option"][data-value="3mo"]').click();
    await expect(page).toHaveURL(/range=3mo.*chips=1/);
    await expect.poll(async () => (await readChipState()).filter((item) => item.source === 'ohlcv-estimate')).toHaveLength(3);
    const threeMonthDram = (await readChipState()).find((item) => item.ticker === 'DRAM');
    expect(threeMonthDram).toMatchObject({model: 'ohlcv-estimate'});
    expect(threeMonthDram.populatedBins).toBeGreaterThan(10);
    expect(chipRequests).toBe(2);
});

test('keeps the Price chart responsive when 1 year is submitted twice', async ({page}) => {
    const consoleErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&range=6mo');
    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    await expect(periodTrigger).toHaveAttribute('aria-label', 'Period: 6 months');
    await periodTrigger.click();
    await page.locator('#period_dropdown [role="option"][data-value="1y"]').click();

    // A repeated change event used to let an older hydration clean up the newer one.
    await page.evaluate(() => {
        document.querySelector('#period')?.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await expect(page).toHaveURL(/\/workspaces\/prices\?ticker=AAPL&ticker=MSFT$/);
    await expect.poll(() => page.locator('#workspace_panel').getAttribute('data-workspace-pending'))
        .toBeNull();
    await expect(page.locator('#period')).toHaveValue('1y');
    await expect(page.locator('.price-compare-range'))
        .toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4} - \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    await expect(page.locator('canvas')).toHaveCount(2);
    expect(consoleErrors.filter((message) => message.includes('Hydration Error'))).toEqual([]);
});

test('keeps the Ticker comparison metric control within the narrow sidebar viewport', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&period=1y');

    await setSidebarExpanded(page, false);
    const controlsToggle = page.locator('[data-workspace-controls-toggle]');
    await expect(controlsToggle).toBeVisible();
    await controlsToggle.click();
    const controlsPanel = page.locator('[data-workspace-controls-panel]');
    await expect(controlsPanel).toBeVisible();
    await controlsPanel.evaluate(async (element) => {
        await Promise.allSettled(
            element.getAnimations().map((animation) => animation.finished),
        );
    });

    const metricField = page.locator('xpath=/html/body/main/div/section/section/div/aside/form/div[3]');
    await expect(metricField).toBeVisible();
    const geometry = await metricField.evaluate((field) => {
        const rect = field.getBoundingClientRect();
        const control = field.querySelector('[data-comparison-metric-switch]');
        const controlRect = control?.getBoundingClientRect();
        return {
            field: {left: rect.left, right: rect.right},
            control: controlRect ? {left: controlRect.left, right: controlRect.right} : null,
            viewportWidth: window.innerWidth,
        };
    });
    expect(geometry.field.left).toBeGreaterThanOrEqual(0);
    expect(geometry.field.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.control).not.toBeNull();
    expect(geometry.control?.left).toBeGreaterThanOrEqual(0);
    expect(geometry.control?.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
});

test('keeps the range pill aligned after responsive sidebar resizing', async ({page}) => {
    const exactUrl = '/workspaces/prices?ticker=AAPL&ticker=MSFT&range=exact&period=1d&date=2026-07-15';
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(exactUrl);
    await setSidebarExpanded(page, false);
    await page.setViewportSize({width: 1008, height: 1123});
    await page.waitForTimeout(500);

    const pillState = await page.locator('.range-mode-shell').evaluate((element) => {
        const pseudo = getComputedStyle(element, '::before');
        const shellRect = element.getBoundingClientRect();
        const activeOption = element.querySelector('input:checked')?.closest('.segmented-control-option');
        const activeRect = activeOption?.getBoundingClientRect();
        const transformMatch = pseudo.transform.match(
            /^matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+)/,
        );
        const translateX = pseudo.transform === 'none'
            ? 0
            : Number.parseFloat(transformMatch?.[1] || 'NaN');
        const pillLeft = shellRect.left + (Number.parseFloat(pseudo.left) || 0) + translateX;
        const pillRight = pillLeft + (Number.parseFloat(pseudo.width) || 0);
        return {
            leftDelta: activeRect ? Math.abs(pillLeft - activeRect.left) : Number.POSITIVE_INFINITY,
            rightDelta: activeRect ? Math.abs(pillRight - activeRect.right) : Number.POSITIVE_INFINITY,
            shellRight: shellRect.right,
            pillRight,
        };
    });

    expect(pillState.leftDelta).toBeLessThanOrEqual(1);
    expect(pillState.rightDelta).toBeLessThanOrEqual(1);
    expect(pillState.pillRight).toBeLessThanOrEqual(pillState.shellRight + 1);
});

test('keeps the active one-day trading date when switching Price performance to Exact', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=1d');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    await page.evaluate(() => {
        const currentTradingDate = '2026-07-23';
        const staleReferenceDate = '2026-07-13';
        window.WORTHWARD_APP.chart.tradingDate = staleReferenceDate;
        for (const id of ['exact_trading_date', 'exact_start', 'exact_end']) {
            document.getElementById(id).value = staleReferenceDate;
        }
        const summary = document.querySelector('.price-compare-range');
        if (summary) summary.textContent = '23 Jul 2026 CST';
    });

    await page.locator('.range-mode-shell label[for="range_exact"]').click();

    await expect(page.locator('#exact_trading_date')).toHaveValue('2026-07-23');
    await expect(page.locator('#exact_start')).toHaveValue('2026-07-23');
    await expect(page.locator('#exact_end')).toHaveValue('2026-07-23');
});

test('presents an active cross-market one-day refresh on the live trading date', async ({page}) => {
    await page.clock.install({time: new Date('2026-07-14T12:00:00+08:00')});
    const livePoints = Array.from({length: 480}, (_, index) => {
        const wallMinutes = (20 * 60) + index;
        const day = wallMinutes >= (24 * 60) ? '14' : '13';
        const minutes = wallMinutes % (24 * 60);
        const pad = (value) => String(value).padStart(2, '0');
        const hour = Math.floor(minutes / 60);
        const minute = minutes % 60;
        const displayMinutes = (9 * 60) + index;
        return {
            displayDate: `14 Jul 2026 ${pad(Math.floor(displayMinutes / 60))}:${pad(displayMinutes % 60)}`,
            price: 100 + (index * 0.01),
            rawDate: `2026-07-${day} ${pad(hour)}:${pad(minute)}`,
        };
    });
    await page.route('**/api/compare/live?*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                liveDate: '2026-07-14',
                liveSessionActive: true,
                displayRange: '14 Jul 2026',
                series: ['000660.KS', '7709.HK'].map((ticker, tickerIndex) => ({
                    ticker,
                    raw_dates: livePoints.map((point) => point.rawDate),
                    dates: livePoints.map((point) => point.displayDate),
                    prices: livePoints.map((point) => point.price + tickerIndex),
                    candlestick_prices: livePoints.map((point, index) => {
                        const close = point.price + tickerIndex;
                        return {
                            x: index,
                            o: close - 0.5,
                            h: close + 0.5,
                            l: close - 1,
                            c: close,
                        };
                    }),
                })),
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=000660.KS&ticker=7709.HK&period=1d');

    const headingDates = await page.evaluate(() => ({
        base: window.WORTHWARD_BOOTSTRAP.dateDisplay.formatFullDateParts({year: 2026, monthIndex: 6, day: 14}),
        local: window.WORTHWARD_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14'),
        hongKong: window.WORTHWARD_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14', 'Asia/Hong_Kong'),
        seoul: window.WORTHWARD_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14', 'Asia/Seoul'),
    }));
    await expect(page.locator('.price-compare-range')).toHaveText(headingDates.local);
    expect(headingDates.hongKong).toBe(`${headingDates.base} HKT`);
    expect(headingDates.seoul).toBe(`${headingDates.base} KST`);
    await expect.poll(() => page.evaluate(() => window.WORTHWARD_APP.chart.tradingDate)).toBe('2026-07-14');
    const rawDates = await page.evaluate(() => window.WORTHWARD_APP.chart.series[0].raw_dates);
    expect(rawDates).toHaveLength(480);
    expect(rawDates[0]).toBe('2026-07-13 20:00');
    expect(rawDates.at(-1)).toBe('2026-07-14 03:59');

    const exactHeading = await page.evaluate(() => {
        window.history.replaceState({}, '', '/workspaces/prices?ticker=000660.KS&ticker=7709.HK&range=exact&period=1d&trading_date=2026-07-14');
        window.WORTHWARD_APP.chart.tradingDate = '2026-07-13';
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        return window.WORTHWARD_BOOTSTRAP.formatPriceCompareHeadingDate('2026-07-14');
    });
    await expect(page.locator('.price-compare-range')).toHaveText(exactHeading);
});

test('shows immediate price-range feedback and preserves add-ticker after hydration', async ({page}) => {
    await page.route('**/workspaces/prices?*', async (route) => {
        const request = route.request();
        const isHydration = request.headers()['x-requested-with'] === 'workspace-hydrate';
        const requestParams = new URL(request.url()).searchParams;
        const isSixMonths = (requestParams.get('range') || requestParams.get('period')) === '6mo';
        if (isHydration && isSixMonths) {
            await new Promise((resolve) => setTimeout(resolve, 600));
        }
        await route.continue();
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1y');

    await page.locator('#period').evaluate((select) => {
        select.value = '6mo';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await expect(page.locator('#workspace_modal_overlay')).toBeVisible();
    await expect(page.locator('#workspace_modal_overlay .workspace-modal-title')).toHaveText('Updating price history');
    await expect(page.locator('.workspace-mode-main .report-heading')).toHaveText('Price history');
    await expect(page.locator('.workspace-mode-main .price-compare-range')).not.toBeEmpty();
    await expect(page).toHaveURL(/range=6mo/);
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();

    await page.locator('#add_ticker').click();
    await expect(page.locator('#ticker_4')).toBeVisible();
});

test('shows immediate feedback while a five-year market-cap range is calculated', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 768});
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1d');
    await expect(page.getByRole('heading', {name: 'Market cap comparison', exact: true, level: 2})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Market cap history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('.market-cap-compare-workspace')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-controls-surface')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-main')).toHaveAttribute('aria-labelledby', 'market_cap_history_heading');
    const marketCapResultArticle = page.locator('xpath=/html/body/main/div/section/section/div/section/div/article');
    await expect(marketCapResultArticle).toHaveCount(1);
    await expect(marketCapResultArticle.locator('.market-cap-compare-range')).toHaveCount(1);
    await expect(page.locator('xpath=/html/body/main/div/section/section/div/section/div/header/div/span')).toHaveCount(0);

    const range = page.locator('.market-cap-compare-range');
    await expect(range).toBeVisible();
    await expect(range).not.toHaveText('');
    const headingGeometry = await page.evaluate(() => {
        const modeCard = document.querySelector('.workspace-mode-title-card').getBoundingClientRect();
        const controls = document.querySelector('.workspace-mode-controls-surface').getBoundingClientRect();
        const resultCard = document.querySelector('.workspace-mode-main .workspace-summary-card').getBoundingClientRect();
        const main = document.querySelector('.workspace-mode-main').getBoundingClientRect();
        const heading = document.querySelector('#market_cap_history_heading').getBoundingClientRect();
        const displayRange = document.querySelector('.market-cap-compare-range').getBoundingClientRect();
        return {
            modeColumnDelta: Math.abs(modeCard.right - controls.right),
            resultColumnDelta: Math.abs(resultCard.left - main.left),
            titleColumnGap: resultCard.left - modeCard.right,
            rangeLeftDelta: Math.abs(displayRange.left - heading.left),
            rangeVerticalGap: displayRange.top - heading.bottom,
        };
    });
    expect(headingGeometry.modeColumnDelta).toBeLessThanOrEqual(1);
    expect(headingGeometry.resultColumnDelta).toBeLessThanOrEqual(1);
    expect(headingGeometry.titleColumnGap).toBeGreaterThanOrEqual(11);
    expect(headingGeometry.rangeLeftDelta).toBeLessThanOrEqual(1);
    expect(headingGeometry.rangeVerticalGap).toBeGreaterThanOrEqual(1);

    const hydrationHtml = await page.content();
    await page.route('**/api/market-store/presence?*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({missingHistory: []}),
        });
    });
    await page.route('**/workspaces/prices?*', async (route) => {
        const request = route.request();
        const isHydration = request.headers()['x-requested-with'] === 'workspace-hydrate';
        const requestParams = new URL(request.url()).searchParams;
        const isMarketCap = requestParams.get('metric') === 'market-cap';
        const isFiveYears = (requestParams.get('range') || requestParams.get('period')) === '5y';
        if (isHydration && isMarketCap && isFiveYears) {
            await new Promise((resolve) => setTimeout(resolve, 600));
            await route.fulfill({
                contentType: 'text/html',
                body: hydrationHtml,
            });
            return;
        }
        await route.continue();
    });

    await page.locator('#period').evaluate((select) => {
        select.value = '5y';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    const overlay = page.locator('#workspace_modal_overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.workspace-modal-title')).toHaveText('Calculating market-cap history');
    await expect(overlay.locator('.workspace-modal-copy')).toContainText('Longer ranges may take a moment.');
    await expect(page).toHaveURL(/range=5y/);
    await expect(overlay).toBeHidden();
});

test('submits a valid market-cap ticker after it is committed by blur', async ({page}) => {
    await page.route('**/api/market-store/presence?*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({missingHistory: []}),
        });
    });
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&ticker=GOOGL&period=1y');
    await page.locator('#add_ticker').click();
    const tickerInput = page.locator('#ticker_4');
    await tickerInput.fill('MSFT');
    const hydrationHtml = await page.content();
    await page.route('**/workspaces/prices?*', async (route) => {
        const request = route.request();
        const isMarketCap = new URL(request.url()).searchParams.get('metric') === 'market-cap';
        if (isMarketCap && request.headers()['x-requested-with'] === 'workspace-hydrate') {
            await route.fulfill({contentType: 'text/html', body: hydrationHtml});
            return;
        }
        await route.continue();
    });

    await page.locator('.workspace-mode-main').click({position: {x: 420, y: 560}});

    await expect(page.locator('#workspace_modal_overlay .workspace-modal-title')).toHaveText(
        /^(Calculating comparison|Updating local market data)$/,
    );
    await expect(page).toHaveURL(/ticker=MSFT/);
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect(page.locator('#market_cap_history_heading')).toBeVisible();
});

test('switches short price ranges and formats price axes by currency precision', async ({page}) => {
    await page.route('**/api/compare/live?*', async (route) => {
        await fulfillInertPriceLiveResponse(route, ['DRAM', 'MU', 'STX']);
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('[data-price-subplot-canvas]'))));

    const formattedTicks = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).options.scales.y.ticks.callback(1040))
    ));
    expect(formattedTicks).toEqual(['1,040', '1,040', '1,040']);

    const fractionalTick = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => (
        window.Chart.getChart(canvas).options.scales.y.ticks.callback(1040.5)
    ));
    expect(fractionalTick).toBe('1,041');

    const threeDayAxis = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => {
            const labels = window.Chart.getChart(canvas).data.labels;
            const dayCounts = labels.reduce((counts, label) => {
                const day = String(label).slice(0, 10);
                counts[day] = (counts[day] || 0) + 1;
                return counts;
            }, {});
            return {
                dayCounts: Object.values(dayCounts),
                dayCount: canvas.dataset.tradingDayCount,
                separators: canvas.dataset.tradingDaySeparators,
            };
        })
    ));
    expect(threeDayAxis.every((item) => (
        item.dayCounts.length === 3
        && item.dayCounts.every((count) => count === 390)
        && item.dayCount === '3'
        && item.separators === '2'
    ))).toBe(true);

    await page.locator('#period').evaluate((select) => {
        select.value = '1d';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#workspace_modal_overlay')).toBeVisible();
    await expect(page).toHaveURL(/range=1d/, {timeout: 30_000});
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect(page.locator('[data-shared-select-trigger-label]')).toHaveText('1 day');

    const oneDayRenderModes = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => ({
            mode: canvas.dataset.chartRenderMode,
            candlePolicy: canvas.dataset.candlePolicy,
            candleBodyStyle: canvas.dataset.candleBodyStyle,
            candleWidthBasis: canvas.dataset.candleWidthBasis,
            candleAlpha: canvas.dataset.candleAlpha,
            candleWidth: canvas.dataset.candleWidth,
            seriesColor: canvas.dataset.seriesColor,
            borderColor: window.Chart.getChart(canvas).data.datasets[0].borderColor,
            showLine: window.Chart.getChart(canvas).data.datasets[0].showLine,
        }))
    ));
    expect(oneDayRenderModes.every((item) => (
        item.mode === 'candlestick'
        && item.candlePolicy === 'v1'
        && item.candleBodyStyle === 'solid'
        && item.candleWidthBasis === 'shared-timeline'
        && item.candleAlpha === '0.82'
        && item.showLine === false
        && item.seriesColor === item.borderColor
    ))).toBe(true);
    expect(new Set(oneDayRenderModes.map((item) => item.candleWidth)).size).toBe(1);
    const expectedPriceSeriesColor = await page.evaluate(() => (
        getComputedStyle(document.body).getPropertyValue('--theme-accent-primary').trim()
    ));
    expect(new Set(oneDayRenderModes.map((item) => item.seriesColor)).size).toBe(1);
    expect(oneDayRenderModes.every((item) => item.seriesColor === expectedPriceSeriesColor)).toBe(true);

    const oneDayAxisLabels = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => {
            const chart = window.Chart.getChart(canvas);
            const labels = chart.data.labels;
            const callback = chart.options.scales.x.ticks.callback;
            const indexes = [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
            return {
                count: canvas.dataset.singleDayTimeLabels,
                labels: indexes.map((index) => callback(index, index)),
            };
        })
    ));
    expect(oneDayAxisLabels.every((item) => (
        item.count === '3'
        && item.labels.every((label) => Array.isArray(label) && label.length === 2 && /^\d{2}:\d{2}$/.test(label[0]))
    ))).toBe(true);

    const oneDaySessionDividers = await page.evaluate(async () => {
        const originalSeries = window.WORTHWARD_APP.chart.series;
        const minutes = Array.from({length: 960}, (_, index) => {
            const totalMinutes = (4 * 60) + index;
            return `2026-07-10 ${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
        });
        window.WORTHWARD_APP.chart.series = originalSeries.map((item, seriesIndex) => ({
            ...item,
            raw_dates: minutes,
            dates: minutes,
            prices: minutes.map((_value, index) => 100 + (seriesIndex * 10) + (index * 0.01)),
            candlestick_prices: minutes.map((_value, index) => {
                const price = 100 + (seriesIndex * 10) + (index * 0.01);
                return {x: index, o: price, h: price + 0.2, l: price - 0.2, c: price + 0.1, v: 100};
            }),
        }));
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const result = canvases.map((canvas, index) => {
            const chart = window.Chart.getChart(canvas);
            const indexes = canvas.dataset.oneDaySessionDividerIndexes.split(',').map((pair) => pair.split(':').map(Number));
            return {
                count: canvas.dataset.oneDaySessionDividers,
                indexes: canvas.dataset.oneDaySessionDividerIndexes,
                lineStyle: canvas.dataset.oneDaySessionDividerLineStyle,
                pluginId: chart.config.plugins.find((plugin) => plugin.id === `priceOneDaySessionDivider${index}`)?.id || '',
                positions: indexes.map(([leftIndex, rightIndex]) => (
                    (chart.scales.x.getPixelForValue(leftIndex) + chart.scales.x.getPixelForValue(rightIndex)) / 2
                )),
                chartArea: {top: chart.chartArea.top, bottom: chart.chartArea.bottom},
            };
        });
        window.WORTHWARD_APP.chart.series = originalSeries;
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(oneDaySessionDividers.every((item) => (
        item.count === '2'
        && item.lineStyle === 'solid-session-divider'
        && item.indexes.split(',').length === 2
        && item.pluginId
        && item.positions.length === 2
        && item.positions[0] < item.positions[1]
        && item.chartArea.bottom > item.chartArea.top
    ))).toBe(true);
    expect(new Set(oneDaySessionDividers.map((item) => item.indexes)).size).toBe(1);
    expect(new Set(oneDaySessionDividers.flatMap((item) => item.positions.map((position) => position.toFixed(3)))).size).toBe(2);
    const firstDividerPositions = oneDaySessionDividers[0].positions;
    expect(oneDaySessionDividers.slice(1).every((item) => item.positions.every((position, positionIndex) => (
        Math.abs(position - firstDividerPositions[positionIndex]) <= 0.01
    )))).toBe(true);

    const overnightSessionDividers = await page.evaluate(() => {
        const originalSeries = window.WORTHWARD_APP.chart.series;
        const originalHref = window.location.href;
        const overnightInput = document.querySelector('#include_overnight_hours');
        const originalChecked = Boolean(overnightInput?.checked);
        const minutes = Array.from({length: 1440}, (_, index) => (
            new Date(Date.UTC(2026, 6, 14, 20, 0) + (index * 60000)).toISOString().slice(0, 16).replace('T', ' ')
        ));
        if (overnightInput) overnightInput.checked = true;
        const params = new URLSearchParams(window.location.search);
        params.set('overnight', '1');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        window.WORTHWARD_APP.chart.series = originalSeries.map((item, seriesIndex) => ({
            ...item,
            raw_dates: minutes,
            dates: minutes,
            prices: minutes.map((_value, index) => 100 + (seriesIndex * 10) + (index * 0.01)),
            candlestick_prices: minutes.map((_value, index) => {
                const price = 100 + (seriesIndex * 10) + (index * 0.01);
                return {x: index, o: price, h: price + 0.2, l: price - 0.2, c: price + 0.1, v: 100};
            }),
        }));
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const result = canvases.map((canvas, index) => {
            const chart = window.Chart.getChart(canvas);
            const indexes = canvas.dataset.oneDaySessionDividerIndexes.split(',').map((pair) => pair.split(':').map(Number));
            return {
                count: canvas.dataset.oneDaySessionDividers,
                indexes: canvas.dataset.oneDaySessionDividerIndexes,
                lineStyle: canvas.dataset.oneDaySessionDividerLineStyle,
                pluginId: chart.config.plugins.find((plugin) => plugin.id === `priceOneDaySessionDivider${index}`)?.id || '',
                positions: indexes.map(([leftIndex, rightIndex]) => (
                    (chart.scales.x.getPixelForValue(leftIndex) + chart.scales.x.getPixelForValue(rightIndex)) / 2
                )),
                chartArea: {top: chart.chartArea.top, bottom: chart.chartArea.bottom},
            };
        });
        window.WORTHWARD_APP.chart.series = originalSeries;
        if (overnightInput) overnightInput.checked = originalChecked;
        window.history.replaceState({}, '', originalHref);
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(overnightSessionDividers.every((item) => (
        item.count === '3'
        && item.lineStyle === 'solid-session-divider'
        && item.indexes.split(',').length === 3
        && item.pluginId
        && item.positions.length === 3
        && item.positions[0] < item.positions[1]
        && item.positions[1] < item.positions[2]
        && item.chartArea.bottom > item.chartArea.top
    ))).toBe(true);
    expect(new Set(overnightSessionDividers.map((item) => item.indexes)).size).toBe(1);
    const firstOvernightDividerPositions = overnightSessionDividers[0].positions;
    expect(overnightSessionDividers.slice(1).every((item) => item.positions.every((position, positionIndex) => (
        Math.abs(position - firstOvernightDividerPositions[positionIndex]) <= 0.01
    )))).toBe(true);

    const referenceLine = await page.evaluate(() => {
        const originalSeries = window.WORTHWARD_APP.chart.series[2];
        const originalProfile = window.WORTHWARD_APP.chart.profiles[2];
        const minutes = Array.from({length: 121}, (_, index) => {
            const totalMinutes = (9 * 60) + 30 + index;
            return `2026-07-10 ${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
        });
        const candles = minutes.map((_value, index) => ({x: index, o: null, h: null, l: null, c: null}));
        candles[14] = {x: 14, o: 149, h: 149, l: 149, c: 149};
        candles[120] = {x: 120, o: 170, h: 172, l: 169, c: 171};
        window.WORTHWARD_APP.chart.series[2] = {
            ...window.WORTHWARD_APP.chart.series[2],
            ticker: 'SKHYV',
            raw_dates: minutes,
            dates: minutes,
            prices: minutes.map((_value, index) => index === 14 ? 149 : (index === 120 ? 171 : null)),
            candlestick_prices: candles,
        };
        window.WORTHWARD_APP.chart.profiles[2] = {
            ticker: 'SKHYV',
            logo_url: '/market-store/logos/000660.KS.svg',
        };
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const result = {
            price: canvases[2].dataset.referencePrice,
            startIndex: canvases[2].dataset.referencePriceStartIndex,
            startTime: canvases[2].dataset.referencePriceStartTime,
            endIndex: canvases[2].dataset.referencePriceEndIndex,
        };
        window.WORTHWARD_APP.chart.series[2] = originalSeries;
        window.WORTHWARD_APP.chart.profiles[2] = originalProfile;
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(referenceLine).toEqual({price: '149.00', startIndex: '0', startTime: '2026-07-10 09:30', endIndex: '120'});

    const currencyPrecision = await page.evaluate(() => ({
        krw: window.WORTHWARD_BOOTSTRAP.currencyDisplay.format(2300000, 'KRW'),
        jpy: window.WORTHWARD_BOOTSTRAP.currencyDisplay.format(1040, 'JPY'),
        usd: window.WORTHWARD_BOOTSTRAP.currencyDisplay.format(64, 'USD'),
    }));
    expect(currencyPrecision).toEqual({krw: 'KRW 2,300,000', jpy: 'JPY 1,040', usd: 'USD 64.00'});

    const tooltipDateLines = await page.evaluate(async () => {
        const host = document.createElement('div');
        host.innerHTML = window.WORTHWARD_BOOTSTRAP.formatPriceSharedTooltipDate(
            '2026-07-10 12:53',
            [],
            {period: '3d'},
        );
        const shortRange = {
            date: host.querySelector('.chart-tooltip-primary-date')?.textContent || '',
            time: host.querySelector('.chart-tooltip-market-time')?.textContent || '',
        };
        host.innerHTML = window.WORTHWARD_BOOTSTRAP.formatPriceSharedTooltipDate(
            '2026-07-10 12:53',
            [],
            {period: '6mo'},
        );
        const originalHref = window.location.href;
        const renderTooltipForPeriod = async (period) => {
            const params = new URLSearchParams(window.location.search);
            params.set('range', period);
            params.delete('period');
            window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
            window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
            const canvas = document.querySelector('[data-price-subplot-canvas]');
            const chart = window.Chart.getChart(canvas);
            chart.options.onHover(
                {y: chart.chartArea.top},
                [{index: 0}],
                chart,
            );
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const tooltip = document.querySelector('.price-shared-tooltip');
            return {
                date: tooltip?.querySelector('.chart-tooltip-primary-date')?.textContent || '',
                time: tooltip?.querySelector('.chart-tooltip-market-time')?.textContent || '',
            };
        };
        const renderedShortRange = await renderTooltipForPeriod('3d');
        const renderedLongRange = await renderTooltipForPeriod('6mo');
        window.history.replaceState({}, '', originalHref);
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        return {
            date: host.querySelector('.chart-tooltip-primary-date')?.textContent || '',
            expectedDate: window.WORTHWARD_BOOTSTRAP.dateDisplay.formatFullDateParts({
                year: 2026,
                monthIndex: 6,
                day: 11,
            }),
            time: host.querySelector('.chart-tooltip-market-time')?.textContent || '',
            shortRange,
            renderedShortRange,
            renderedLongRange,
        };
    });
    expect(tooltipDateLines.date).toBe(tooltipDateLines.expectedDate);
    expect(tooltipDateLines.time).toBe('');
    expect(tooltipDateLines.shortRange).toEqual({
        date: tooltipDateLines.expectedDate,
        time: '00:53 HKT',
    });
    expect(tooltipDateLines.renderedShortRange.time).toBeTruthy();
    expect(tooltipDateLines.renderedLongRange.time).toBe('');

    const multiMarketPresentation = await page.evaluate(() => {
        const tickers = ['0005.HK', 'HSBA.L', 'HSBC'];
        const rawDates = [
            '2026-07-10 03:00',
            '2026-07-10 04:00',
            '2026-07-10 09:30',
        ];
        const host = document.createElement('div');
        host.innerHTML = window.WORTHWARD_BOOTSTRAP.formatPriceSharedTooltipDate(
            '2026-07-09 23:06',
            tickers,
        );
        const originalSeries = window.WORTHWARD_APP.chart.series;
        const originalProfiles = window.WORTHWARD_APP.chart.profiles;
        window.WORTHWARD_APP.chart.series = tickers.map((ticker, index) => ({
            ticker,
            raw_dates: rawDates,
            dates: rawDates,
            prices: [100 + index, 101 + index, 102 + index],
            color: ['#0055cc', '#7f42af', '#ff2f92'][index],
        }));
        window.WORTHWARD_APP.chart.profiles = tickers.map((ticker) => ({
            ticker,
            logo_url: null,
        }));
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        const lineStyles = [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .map((canvas) => canvas.dataset.marketSessionLineStyle || '');
        const result = {
            events: window.WORTHWARD_BOOTSTRAP.buildPriceMarketSessionEvents(rawDates, tickers),
            koreaUsEvents: window.WORTHWARD_BOOTSTRAP.buildPriceMarketSessionEvents(
                ['2026-07-09 20:00', '2026-07-10 02:30', '2026-07-10 04:00'],
                ['000660.KS', 'SKHYV'],
            ),
            lineStyles,
            date: host.querySelector('.chart-tooltip-primary-date')?.textContent || '',
            expectedDate: window.WORTHWARD_BOOTSTRAP.dateDisplay.formatFullDateParts({
                year: 2026,
                monthIndex: 6,
                day: 10,
            }),
            times: [...host.querySelectorAll('.chart-tooltip-market-time')].map((item) => item.textContent),
            collisionSafeLabels: window.WORTHWARD_BOOTSTRAP.layoutPriceMarketSessionLabels({
                events: [
                    {index: 0, labelLines: ['20:00']},
                    {index: 1, labelLines: ['02:30']},
                    {index: 2, labelLines: ['04:00']},
                ],
                getX: (event) => [8, 48, 60][event.index],
                measureText: () => 34,
                left: 0,
                right: 150,
                gap: 10,
            }).map(({x, width}) => ({x, width})),
        };
        window.WORTHWARD_APP.chart.series = originalSeries;
        window.WORTHWARD_APP.chart.profiles = originalProfiles;
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        return result;
    });
    expect(multiMarketPresentation.events.map((event) => ({
        index: event.index,
        labelLines: event.labelLines,
    }))).toEqual([
        {index: 0, labelLines: ['03:00']},
        {index: 1, labelLines: ['04:00']},
    ]);
    expect(multiMarketPresentation.lineStyles).toEqual([
        'solid-session-divider',
        'solid-session-divider',
        'solid-session-divider',
    ]);
    expect(multiMarketPresentation.koreaUsEvents.map((event) => ({
        index: event.index,
        labelLines: event.labelLines,
    }))).toEqual([
        {index: 0, labelLines: ['20:00']},
        {index: 1, labelLines: ['02:30']},
        {index: 2, labelLines: ['04:00']},
    ]);
    expect(multiMarketPresentation.date).toBe(multiMarketPresentation.expectedDate);
    expect(multiMarketPresentation.times).toEqual([
        '11:06 HKT',
        '04:06 BST',
        '23:06 EDT (-1)',
    ]);
    expect(multiMarketPresentation.collisionSafeLabels[0].x).toBeGreaterThanOrEqual(17);
    expect(multiMarketPresentation.collisionSafeLabels[2].x).toBeLessThanOrEqual(133);
    expect(multiMarketPresentation.collisionSafeLabels[1].x - multiMarketPresentation.collisionSafeLabels[0].x).toBeGreaterThanOrEqual(44);
    expect(multiMarketPresentation.collisionSafeLabels[2].x - multiMarketPresentation.collisionSafeLabels[1].x).toBeGreaterThanOrEqual(44);

    await page.evaluate(() => window.WORTHWARD_BOOTSTRAP.refreshPriceCompareLive());
    const labelsAfterEmptyRefresh = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).data.datasets[0].label)
    ));
    expect(labelsAfterEmptyRefresh).toEqual(['DRAM', 'MU', 'STX']);

    await page.locator('#period').evaluate((select) => {
        select.value = '3d';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#workspace_modal_overlay')).toBeVisible();
    await expect(page).toHaveURL(/range=3d/, {timeout: 30_000});
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect(page.locator('[data-shared-select-trigger-label]')).toHaveText('3 days');
});

test('sizes Price comparison y-axes to the widest rendered labels for strict shared x alignment', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&ticker=MU&ticker=AMD&period=1y');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('[data-price-subplot-canvas]'))));
    await page.evaluate(() => {
        const ranges = [
            [220, 360],
            [160, 240],
            [0, 1_400],
            [150, 600],
        ];
        window.WORTHWARD_APP.chart.series = window.WORTHWARD_APP.chart.series.map((item, index) => {
            const [minimum, maximum] = ranges[index];
            const sourcePrices = Array.isArray(item.prices) ? item.prices : [];
            return {
                ...item,
                prices: sourcePrices.map((_value, priceIndex) => {
                    const progress = sourcePrices.length > 1 ? priceIndex / (sourcePrices.length - 1) : 0;
                    return minimum + ((maximum - minimum) * progress);
                }),
                candlestick_prices: [],
            };
        });
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
    });
    await page.waitForFunction(() => (
        document.querySelectorAll('[data-price-subplot-canvas]').length === 4
        && [...document.querySelectorAll('[data-price-subplot-canvas]')].every((canvas) => Boolean(window.Chart.getChart(canvas)))
    ));

    const desktopAxes = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => {
            const scale = window.Chart.getChart(canvas).scales.y;
            const widestLabelWidth = Number(scale._labelSizes?.widest?.width) || 0;
            const tickPadding = Number(scale.options?.ticks?.padding) || 0;
            const borderWidth = scale.options?.border?.display === false ? 0 : 1;
            return {
                width: scale.width,
                expectedWidth: Math.max(36, Math.ceil(widestLabelWidth + tickPadding + borderWidth + 2)),
                chartAreaLeft: window.Chart.getChart(canvas).chartArea.left,
            };
        })
    ));
    expect(desktopAxes.length).toBe(4);
    const sharedWidth = Math.max(...desktopAxes.map(({expectedWidth}) => expectedWidth));
    expect(desktopAxes.every(({width}) => Math.abs(width - sharedWidth) < 0.01)).toBe(true);
    expect(desktopAxes.every(({width}) => width < 92)).toBe(true);
    expect(new Set(desktopAxes.map(({chartAreaLeft}) => Math.round(chartAreaLeft))).size).toBe(1);

    await page.setViewportSize({width: 390, height: 844});
    await expect.poll(async () => page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).scales.y.width)
    ))).toHaveLength(4);
    const narrowLayout = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
    }));
    expect(narrowLayout.documentWidth).toBeLessThanOrEqual(narrowLayout.viewportWidth);
});

test('discards an obsolete live-price response after the selected range changes', async ({page}) => {
    let releaseLiveResponse;
    const liveRequestStarted = new Promise((resolve) => {
        releaseLiveResponse = resolve;
    });
    let fulfillLiveResponse;
    let shouldHoldLiveResponse = false;
    await page.route('**/api/compare/live?*', async (route) => {
        if (!shouldHoldLiveResponse) {
            await fulfillInertPriceLiveResponse(route, ['DRAM', 'MU', 'STX']);
            return;
        }
        await new Promise((resolve) => {
            fulfillLiveResponse = resolve;
            releaseLiveResponse();
        });
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: [{
                    ticker: 'STALE',
                    raw_dates: ['2026-07-08 09:30'],
                    dates: ['8 Jul 2026 09:30'],
                    prices: [1.0],
                    candlestick_prices: [],
                }],
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('[data-price-subplot-canvas]'))));

    shouldHoldLiveResponse = true;
    const refreshPromise = page.evaluate(() => window.WORTHWARD_BOOTSTRAP.refreshPriceCompareLive());
    await liveRequestStarted;
    await page.evaluate(() => {
        const params = new URLSearchParams(window.location.search);
        params.set('period', '1d');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    });
    fulfillLiveResponse();
    await refreshPromise;

    const chartLabels = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).data.datasets[0].label)
    ));
    expect(chartLabels).toEqual(['DRAM', 'MU', 'STX']);
});
