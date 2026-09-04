import {expect, test} from '@playwright/test';

/* Code version: v1.0.1 */

const lstmUrl = (
    '/workspaces/backtest?ticker=DRAM&strategy=lstm-price-field'
    + '&show_trade_details=0&use_option_total_open_interest=1'
    + '&use_option_total_volume=1&cell_display_threshold=2.00'
);

const readPresentation = (page) => page.evaluate(() => {
    const payload = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
    return payload?.schema === 'lstm-price-field/v1' ? payload : null;
});

const injectPriceFieldPresentation = (page) => page.evaluate(() => {
    const result = window.WORTHWARD_APP?.backtestResult;
    if (!result?.chart) throw new Error('Backtest chart shell is unavailable.');
    const rawDates = [];
    const cursor = new Date('2026-06-01T00:00:00Z');
    while (rawDates.length < 65) {
        const weekday = cursor.getUTCDay();
        if (weekday !== 0 && weekday !== 6) rawDates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const close = rawDates.map((date, index) => {
        const baseline = 50 + (Math.sin(index / 4) * 7);
        if (date === '2026-07-28') return 52;
        if (date === '2026-07-29') return 51;
        return baseline;
    });
    const equity = close.map((value, index) => 10_000 + ((value - close[0]) * 40) + (index * 3));
    result.interval = '1d';
    result.multi_asset = false;
    result.trades = [];
    result.chart = {
        ...(result.chart || {}),
        dates: [...rawDates],
        raw_dates: [...rawDates],
        open: close.map((value) => value - 0.4),
        high: close.map((value) => value + 0.8),
        low: close.map((value) => value - 0.9),
        close,
        equity,
        all_in_equity: equity.map((value, index) => value + index),
    };
    result.strategy_presentation = {
        schema: 'lstm-price-field/v1',
        renderer: 'probability-grid-v1',
        rows_above: 10,
        rows_below: 10,
        columns: 20,
        width_fraction: 0.25,
        gap_px: 2,
        padding_px: 8,
        min_cell_px: 4,
        cell_opacity_mapping: 'instant-contrast-power-v1',
        cell_opacity_exponent: 1.6,
        cell_opacity_tail_ratio: 0.02,
        cell_display_threshold_pct: 0,
        time_quantization: 'integer-trading-days',
        distribution_kind: 'dynamic-normal-log-return',
        target_interval: 'next-open-to-following-open',
        price_anchor_kind: 'signal-close-display-anchor',
        multi_step_kind: 'causal-ar1-return-state',
        return_autoregression: rawDates.map(() => 0.2),
        return_long_run_mean: rawDates.map(() => 0),
        return_innovation_scale: rawDates.map(() => 0.012),
        data_keys: [...rawDates],
        predictive_mean: rawDates.map(() => 0.001),
        predictive_scale: rawDates.map(() => 0.02),
    };
    window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
    window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
});

const readSnapshot = (page) => page.evaluate(() => {
    const canvas = document.querySelector('#tradePriceChart');
    const chart = window.Chart?.getChart?.(canvas);
    const stack = canvas?.closest('.trade-chart-stack');
    const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
    const horizontalLine = document.querySelector('.trade-chart-hover-horizontal-line');
    const bounds = chart?._activeBacktestProbabilityGridBounds;
    const canvasRect = canvas?.getBoundingClientRect();
    const stackRect = stack?.getBoundingClientRect();
    const tooltipRect = tooltip?.getBoundingClientRect();
    const lineRect = horizontalLine?.getBoundingClientRect();
    const point = Number.isInteger(bounds?.index)
        ? chart?.getDatasetMeta?.(0)?.data?.[bounds.index]
        : null;
    const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || [])
        .filter((cell) => cell.dataset.column === '0')
        .map((cell) => {
            const rect = cell.getBoundingClientRect();
            return {
                bottom: rect.bottom,
                className: cell.className,
                row: Number(cell.dataset.row),
                sign: cell.classList.contains('is-up') ? 'up' : 'down',
                top: rect.top,
            };
        });
    return {
        activeIndex: bounds?.index ?? null,
        anchorY: bounds?.anchorY ?? null,
        canvas: canvasRect ? {height: canvasRect.height, top: canvasRect.top} : null,
        chart: chart ? {height: chart.height} : null,
        cells,
        date: Number.isInteger(bounds?.index)
            ? window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates?.[bounds.index]
            : null,
        intersectionY: bounds?.intersectionY ?? null,
        lineY: lineRect ? lineRect.top + (lineRect.height / 2) : null,
        pointY: point?.y ?? null,
        tooltip: tooltipRect ? {
            bottom: tooltipRect.bottom,
            left: tooltipRect.left,
            right: tooltipRect.right,
            top: tooltipRect.top,
        } : null,
        stack: stackRect ? {left: stackRect.left, right: stackRect.right} : null,
    };
});

test('records LSTM Price Field guide alignment for 28 and 29 Jul 2026', async ({page}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({width: 974, height: 1278});
    await page.goto(lstmUrl);
    await expect.poll(() => readPresentation(page), {timeout: 90_000}).not.toBeNull();
    await injectPriceFieldPresentation(page);
    const sidebarToggle = page.getByRole('button', {name: 'Toggle sidebar'});
    if (await sidebarToggle.getAttribute('aria-expanded') === 'true') {
        await sidebarToggle.click();
    }
    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(page.locator('#backtest_probability_detail_panel')).toBeVisible();

    const readTargetPoints = () => page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const dates = window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates || [];
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        return ['2026-07-28', '2026-07-29'].map((date) => {
            const index = dates.indexOf(date);
            const point = points[index];
            return index >= 0 && point && rect && chart?.width > 0 && chart?.height > 0
                ? {
                    date,
                    index,
                    x: rect.left + (point.x * (rect.width / chart.width)),
                    y: rect.top + (point.y * (rect.height / chart.height)),
                }
                : null;
        });
    });
    await expect.poll(
        async () => (await readTargetPoints()).filter(Boolean).length,
        {timeout: 90_000},
    ).toBe(2);
    const targetDates = ['2026-07-28', '2026-07-29'];
    for (const [targetPosition, date] of targetDates.entries()) {
        if (targetPosition > 0) {
            await page.mouse.move(10, 10);
            await page.keyboard.press('Escape');
            await expect(page.locator('[data-backtest-chart-tooltip="probability-grid"]'))
                .not.toHaveClass(/is-visible/);
            await page.waitForTimeout(80);
        }
        const target = (await readTargetPoints()).find((point) => point?.date === date);
        expect(target).toBeTruthy();
        await page.mouse.move(target.x, target.y);
        await expect.poll(() => readSnapshot(page)).toMatchObject({
            activeIndex: target.index,
            date: target.date,
        });
        await expect.poll(async () => {
            const snapshot = await readSnapshot(page);
            const upCells = snapshot.cells.filter((cell) => cell.sign === 'up');
            const downCells = snapshot.cells.filter((cell) => cell.sign === 'down');
            if (!snapshot.canvas || !snapshot.chart || !Number.isFinite(snapshot.lineY)
                || !Number.isFinite(snapshot.anchorY) || !Number.isFinite(snapshot.intersectionY)
                || !upCells.length || !downCells.length) return false;
            const expectedLineY = snapshot.canvas.top
                + (snapshot.anchorY * (snapshot.canvas.height / snapshot.chart.height));
            return Math.abs(snapshot.intersectionY - snapshot.anchorY) < 0.01
                && Math.abs(snapshot.lineY - expectedLineY) <= 1.5
                && upCells.at(-1).bottom <= snapshot.lineY + 1
                && downCells[0].top >= snapshot.lineY - 1;
        }, {timeout: 5_000}).toBe(true);
        const snapshot = await readSnapshot(page);
        expect(Math.abs(snapshot.intersectionY - snapshot.anchorY)).toBeLessThan(0.01);
        const expectedLineY = snapshot.canvas.top
            + (snapshot.anchorY * (snapshot.canvas.height / snapshot.chart.height));
        expect(Math.abs(snapshot.lineY - expectedLineY)).toBeLessThanOrEqual(1.5);
        const upCells = snapshot.cells.filter((cell) => cell.sign === 'up');
        const downCells = snapshot.cells.filter((cell) => cell.sign === 'down');
        expect(upCells.length).toBeGreaterThan(0);
        expect(downCells.length).toBeGreaterThan(0);
        expect(upCells.at(-1).bottom).toBeLessThanOrEqual(snapshot.lineY + 1);
        expect(downCells[0].top).toBeGreaterThanOrEqual(snapshot.lineY - 1);
    }
});
