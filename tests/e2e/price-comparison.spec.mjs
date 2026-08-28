/* Code version: v0.1.1 */
import {expect, test} from '@playwright/test';

test('separates wide market-cap magnitudes without transforming their absolute values', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('#returnsChart'))));

    const chartState = await page.evaluate(() => {
        const state = window.ANTIGRAVITY_APP;
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
        window.ANTIGRAVITY_BOOTSTRAP.initChartWorkspace();
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
        window.ANTIGRAVITY_BOOTSTRAP.initChartWorkspace();
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
