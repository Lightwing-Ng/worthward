/* Code version: v0.1.3 */
import {expect, test} from '@playwright/test';

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
