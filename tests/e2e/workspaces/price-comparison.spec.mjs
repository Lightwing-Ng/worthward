/* Code version: v0.3.1 */
import {expect, test} from '@playwright/test';

test('reuses the Backtest controls-overlay contract for the second Prices sidebar', async ({page}) => {
    await page.addInitScript(() => {
        window.sessionStorage.setItem('worthward:sidebar-open', 'false');
        window.sessionStorage.removeItem('worthward:price-comparison-controls-open');
    });
    await page.setViewportSize({width: 751, height: 912});
    await page.goto('/workspaces/prices?ticker=000660.KS&ticker=SKHY&range=1d');
    await page.locator('[data-dismissible-notice]').evaluateAll((notices) => {
        notices.forEach((notice) => { notice.hidden = true; });
    });

    const shell = page.locator('[data-workspace-controls-shell]');
    const layout = shell.locator(':scope > .workspace-mode-layout');
    const main = layout.locator(':scope > .workspace-mode-main');
    const panel = page.locator('[data-workspace-controls-panel]');
    const toggle = page.locator('[data-workspace-controls-toggle]');
    const backdrop = page.locator('[data-workspace-controls-backdrop]');
    const globalToggle = page.locator('#sidebar_toggle');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'price_compare_controls_panel');
    await expect(toggle.locator('.icon-workspace-controls')).toHaveCSS(
        'mask-image',
        /arrowtriangle\.forward\.inset\.filled\.trailingthird\.rectangle\.svg/,
    );
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(panel).toBeHidden();
    await expect(backdrop).toBeHidden();

    const collapsedGeometry = await page.evaluate(() => {
        const layoutElement = document.querySelector('[data-workspace-controls-shell] > .workspace-mode-layout');
        const mainElement = layoutElement.querySelector(':scope > .workspace-mode-main');
        const panelElement = document.querySelector('[data-workspace-controls-panel]');
        const toggleElement = document.querySelector('[data-workspace-controls-toggle]');
        const titleElement = document.querySelector('#ticker_comparison_heading');
        const layoutBox = layoutElement.getBoundingClientRect();
        const mainBox = mainElement.getBoundingClientRect();
        const panelBox = panelElement.getBoundingClientRect();
        const toggleBox = toggleElement.getBoundingClientRect();
        const titleBox = titleElement.getBoundingClientRect();
        return {
            columns: getComputedStyle(layoutElement).gridTemplateColumns,
            layout: {left: layoutBox.left, right: layoutBox.right, width: layoutBox.width},
            main: {left: mainBox.left, right: mainBox.right, width: mainBox.width},
            panel: {right: panelBox.right, position: getComputedStyle(panelElement).position},
            toggle: {width: toggleBox.width, height: toggleBox.height, right: toggleBox.right},
            titleLeft: titleBox.left,
            horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
    });
    expect(collapsedGeometry.columns).toBe(`${collapsedGeometry.layout.width}px`);
    expect(Math.abs(collapsedGeometry.main.left - collapsedGeometry.layout.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsedGeometry.main.right - collapsedGeometry.layout.right)).toBeLessThanOrEqual(1);
    expect(collapsedGeometry.panel.position).toBe('fixed');
    expect(collapsedGeometry.panel.right).toBeLessThanOrEqual(0);
    expect(collapsedGeometry.toggle.width).toBe(44);
    expect(collapsedGeometry.toggle.height).toBe(44);
    expect(collapsedGeometry.titleLeft).toBeGreaterThanOrEqual(collapsedGeometry.toggle.right + 8);
    expect(collapsedGeometry.horizontalOverflow).toBeLessThanOrEqual(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panel).toBeVisible();
    await expect(backdrop).toBeVisible();
    await expect(shell).toHaveClass(/is-controls-overlay-open/);
    await expect.poll(() => panel.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        return {
            insideViewport: box.left >= 0 && box.right <= window.innerWidth,
            overflowY: styles.overflowY,
        };
    })).toEqual({insideViewport: true, overflowY: 'auto'});
    await expect.poll(() => page.evaluate(() => (
        window.sessionStorage.getItem('worthward:price-comparison-controls-open')
    ))).toBe('true');

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();

    await toggle.click();
    await expect(panel).toBeVisible();
    await globalToggle.click();
    await expect(globalToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeHidden();
    await expect(panel).toBeHidden();
    await globalToggle.click();
    await expect(globalToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await page.setViewportSize({width: 901, height: 912});
    await expect(toggle).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(() => layout.evaluate((element) => (
        getComputedStyle(element).gridTemplateColumns
    ))).toMatch(/^312px /);
    await expect(main).toBeVisible();
});

test('accepts SMH as a selectable ETF ticker', async ({page}) => {
    await page.route('**/api/symbol-search?q=SMH*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([{
                symbol: 'SMH',
                name: 'VanEck Semiconductor ETF',
                logo_url: '',
                source: 'local',
            }]),
        });
    });
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=JEPQ&period=1y');

    const input = page.locator('#ticker_2');
    await input.fill('SMH');

    const suggestion = page.locator('#ticker_2_suggestions .suggestion-item[data-symbol="SMH"]');
    await expect(suggestion).toBeVisible();
    await expect(input).toHaveValue('SMH');
    await expect(input).not.toHaveClass(/is-invalid/);
});

test('separates wide market-cap magnitudes without transforming their absolute values', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('#returnsChart'))));

    const chartState = await page.evaluate(() => {
        const state = window.WORTHWARD_APP;
        const rawDates = ['2026-01-01 00:00', '2026-01-02 00:00', '2026-01-03 00:00'];
        const terminalValues = [5_500_000_000_000, 1_300_000_000_000, 900_000_000_000, 600_000_000_000, 350_000_000_000];
        state.currentView = 'prices';
        state.comparisonMetric = 'market-cap';
        state.chart = {
            ...state.chart,
            profiles: [],
            series: terminalValues.map((terminalValue, index) => ({
                ticker: `CAP${index + 1}`,
                dates: rawDates,
                raw_dates: rawDates,
                normalized_returns: [0, 0, 0],
                market_caps: index === 4
                    ? [0, 0, terminalValue]
                    : [terminalValue * 0.9, terminalValue * 0.95, terminalValue],
                color: ['#7f3fbf', '#ff2f92', '#0055cc', '#2fff9c', '#ff6b35'][index],
            })),
        };
        window.WORTHWARD_BOOTSTRAP.initChartWorkspace();
        const canvas = document.querySelector('#returnsChart');
        const chart = window.Chart.getChart(canvas);
        const terminalPixels = terminalValues.map((value) => chart.scales.y.getPixelForValue(value));
        const sortedPixels = [...terminalPixels].sort((left, right) => left - right);
        const pixelGaps = sortedPixels.slice(1).map((value, index) => value - sortedPixels[index]);
        const wideScaleType = chart.scales.y.type;
        const wideScaleContract = canvas.dataset.marketCapScale;
        const renderedTerminalValues = chart.data.datasets.map((dataset) => dataset.data.at(-1));
        const missingMarketCapGaps = chart.data.datasets.at(-1).data.slice(0, 2);

        state.chart = {
            ...state.chart,
            series: [1_000_000_000_000, 1_100_000_000_000].map((terminalValue, index) => ({
                ticker: `PEER${index + 1}`,
                dates: rawDates,
                raw_dates: rawDates,
                normalized_returns: [0, 0, 0],
                market_caps: [terminalValue * 0.98, terminalValue * 0.99, terminalValue],
                color: index === 0 ? '#0055cc' : '#ff2f92',
            })),
        };
        window.WORTHWARD_BOOTSTRAP.initChartWorkspace();
        const peerChart = window.Chart.getChart(canvas);

        return {
            wideScaleType,
            wideScaleContract,
            terminalValues,
            renderedTerminalValues,
            missingMarketCapGaps,
            pixelGaps,
            peerScaleType: peerChart.scales.y.type,
            peerScaleContract: canvas.dataset.marketCapScale,
        };
    });

    expect(chartState.wideScaleType).toBe('logarithmic');
    expect(chartState.wideScaleContract).toBe('logarithmic');
    expect(chartState.renderedTerminalValues).toEqual(chartState.terminalValues);
    expect(chartState.missingMarketCapGaps).toEqual([null, null]);
    expect(Math.min(...chartState.pixelGaps)).toBeGreaterThan(20);
    expect(chartState.peerScaleType).toBe('linear');
    expect(chartState.peerScaleContract).toBe('linear');
});

test('uses the primary-blue token for Price curves while preserving the Market cap palette', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&range=2y&chips=1');
    await page.waitForFunction(() => (
        document.querySelectorAll('[data-price-subplot-canvas]').length === 2
        && [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));

    const priceState = await page.evaluate(() => {
        const state = window.WORTHWARD_APP;
        const primary = getComputedStyle(document.body).getPropertyValue('--theme-accent-primary').trim();
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        return {
            primary,
            tickers: canvases.map((canvas) => canvas.closest('[data-price-subplot]')?.dataset.ticker || ''),
            canvasColors: canvases.map((canvas) => canvas.dataset.seriesColor),
            chartColors: canvases.map((canvas) => window.Chart.getChart(canvas).data.datasets[0].borderColor),
            comparisonMetric: state.comparisonMetric,
            comparisonChips: state.comparisonChips,
        };
    });

    expect(priceState.tickers).toEqual(['AAPL', 'NVDA']);
    expect(priceState.comparisonMetric).toBe('price');
    expect(priceState.comparisonChips).toBe(true);
    expect(priceState.canvasColors).toEqual([priceState.primary, priceState.primary]);
    expect(priceState.chartColors).toEqual([priceState.primary, priceState.primary]);

    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&range=2y');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('#returnsChart'))));
    const marketCapState = await page.evaluate(() => {
        const state = window.WORTHWARD_APP;
        const chart = window.Chart.getChart(document.querySelector('#returnsChart'));
        return {
            seriesColors: state.chart.series.map((item) => item.color),
            chartColors: chart.data.datasets.map((dataset) => dataset.borderColor),
            primary: state.theme.accent_primary,
            secondary: state.theme.accent_secondary,
        };
    });

    expect(marketCapState.chartColors).toEqual(marketCapState.seriesColors);
    expect(marketCapState.chartColors).toEqual([
        marketCapState.primary,
        marketCapState.secondary,
    ]);
});

test('keeps mixed-market Price Y axes currency-free while retaining tooltip currencies', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&ticker=MSFT&range=1y');
    await page.waitForFunction(() => (
        document.querySelectorAll('[data-price-subplot-canvas]').length === 3
        && [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));

    const axisState = await page.evaluate(() => {
        const tickers = ['000660.KS', '7709.HK', 'DRAM'];
        window.WORTHWARD_APP.chart.series.forEach((item, index) => {
            item.ticker = tickers[index];
        });
        window.WORTHWARD_APP.chart.profiles.forEach((profile, index) => {
            profile.ticker = tickers[index];
        });
        document.querySelectorAll('[data-price-subplot]').forEach((section, index) => {
            section.dataset.ticker = tickers[index];
        });
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();

        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const axes = canvases.map((canvas) => {
            const chart = window.Chart.getChart(canvas);
            const ticks = chart.scales.y.ticks;
            const callback = chart.options.scales.y.ticks.callback;
            return {
                width: Number(canvas.dataset.sharedYAxisWidth),
                labels: ticks.map((tick, index) => String(
                    callback.call(chart.scales.y, tick.value, index, ticks),
                )),
            };
        });
        const sourceCanvas = canvases[0];
        const sourceChart = window.Chart.getChart(sourceCanvas);
        const dataIndex = window.WORTHWARD_APP.chart.series[0].prices.findLastIndex((_price, index) => (
            window.WORTHWARD_APP.chart.series.every((item) => Number.isFinite(Number(item.prices[index])))
        ));
        const point = sourceChart.getDatasetMeta(0).data[dataIndex];
        const rect = sourceCanvas.getBoundingClientRect();
        return {
            axes,
            pointer: {
                x: rect.left + ((point.x / sourceChart.width) * rect.width),
                y: rect.top + ((point.y / sourceChart.height) * rect.height),
            },
        };
    });

    expect(axisState.axes.every((axis) => axis.labels.length > 0)).toBe(true);
    expect(axisState.axes.flatMap((axis) => axis.labels)).not.toContainEqual(
        expect.stringMatching(/^(?:KRW|HKD|USD)\s/),
    );
    expect(new Set(axisState.axes.map((axis) => axis.width)).size).toBe(1);

    await page.mouse.move(axisState.pointer.x, axisState.pointer.y);
    await expect(page.locator('.price-shared-tooltip')).toHaveClass(/is-visible/);
    await expect(page.locator('.price-shared-tooltip .chart-tooltip-value')).toHaveText([
        /^KRW\s/,
        /^HKD\s/,
        /^USD\s/,
    ]);
});

test('retries a transient per-ticker chip error without discarding successful profiles', async ({page}) => {
    const requests = [];
    const buildOhlcv = (tickerIndex) => Array.from({length: 12}, (_, rowIndex) => {
        const close = 100 + (tickerIndex * 50) + rowIndex;
        return {
            t: `2026-07-${String(rowIndex + 1).padStart(2, '0')} 00:00`,
            o: close - 1,
            h: close + 2,
            l: close - 2,
            c: close,
            v: 100_000 + (rowIndex * 1_000),
        };
    });
    await page.route('**/api/compare/chips**', async (route) => {
        const tickers = new URL(route.request().url()).searchParams.getAll('ticker');
        requests.push(tickers);
        const recovered = requests.length > 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers
                    .filter((ticker) => recovered || ticker !== 'NVDA')
                    .map((ticker) => ({
                        ticker,
                        source: 'longbridge-daily-ohlcv',
                        ohlcv: buildOhlcv(ticker === 'NVDA' ? 1 : 0),
                    })),
                errors: recovered ? {} : {NVDA: 'Temporary Longbridge failure.'},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&range=1y');
    await page.evaluate(() => {
        window.WORTHWARD_APP.chart.series.forEach((item) => {
            item.ohlcv = [];
        });
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
    });
    await page.locator('label[for="show_chips"]').click();

    await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
    expect(requests[0]).toEqual(['AAPL', 'NVDA']);
    expect(requests[1]).toEqual(['NVDA', 'AAPL']);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(2);
    await expect(page.locator('[data-chips-chart-status]')).toBeEmpty();
});

test('does not request a Longbridge fallback for a ticker with usable local OHLCV', async ({page}) => {
    const requests = [];
    const buildOhlcv = (basePrice) => Array.from({length: 12}, (_, rowIndex) => {
        const close = basePrice + rowIndex;
        return {
            t: `2026-08-${String(rowIndex + 1).padStart(2, '0')} 00:00`,
            o: close - 1,
            h: close + 2,
            l: close - 2,
            c: close,
            v: 100_000 + (rowIndex * 1_000),
        };
    });
    await page.route('**/api/compare/chips**', async (route) => {
        const tickers = new URL(route.request().url()).searchParams.getAll('ticker');
        requests.push(tickers);
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers.map((ticker, index) => ({
                    ticker,
                    source: 'longbridge-daily-ohlcv',
                    ohlcv: buildOhlcv(100 + (index * 50)),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&ticker=MSFT&range=1y');
    await page.evaluate((localOhlcv) => {
        const tickers = ['000660.KS', '7709.HK', 'DRAM'];
        window.WORTHWARD_APP.chart.series.forEach((item, index) => {
            item.ticker = tickers[index];
            item.ohlcv = index === 0 ? localOhlcv : [];
        });
        window.WORTHWARD_APP.chart.profiles.forEach((profile, index) => {
            profile.ticker = tickers[index];
        });
        document.querySelectorAll('[data-price-subplot]').forEach((section, index) => {
            section.dataset.ticker = tickers[index];
        });
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
    }, buildOhlcv(280_000));
    await page.locator('label[for="show_chips"]').click();

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual(['7709.HK', 'DRAM']);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(3);
    await expect(page.locator('[data-chips-chart-status]')).toBeEmpty();
});
