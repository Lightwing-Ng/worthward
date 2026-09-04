import {test, expect} from '@playwright/test';

/* Code version: v1.1.0 */

test('keeps the Bayesian probability field unique at the final curve endpoint', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 974, height: 1278});
    await page.goto(
        '/workspaces/backtest?ticker=DRAM&strategy=bayesian-price-field'
        + '&show_trade_details=0&use_pe_ratio=0&cell_display_threshold=2.5',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(page.locator('#backtest_probability_detail_panel')).toBeVisible();

    const endpoint = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const stack = canvas?.closest('.trade-chart-stack');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        const lastIndex = points.length - 1;
        const point = points[lastIndex];
        return canvas instanceof HTMLCanvasElement && stack instanceof HTMLElement
            && rect && chart && point && chart.width > 0 && chart.height > 0
            ? {
                x: rect.left + (point.x * (rect.width / chart.width)),
                y: rect.top + (point.y * (rect.height / chart.height)),
            }
            : null;
    });
    expect(endpoint).not.toBeNull();
    await page.mouse.move(endpoint.x, endpoint.y);
    const probabilityTooltip = page.locator('[data-backtest-chart-tooltip="probability-grid"]');
    await expect(probabilityTooltip).toHaveClass(/is-visible/);

    const readSnapshot = () => page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const stack = canvas?.closest('.trade-chart-stack');
        const chart = window.Chart?.getChart?.(canvas);
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const hoverLine = document.querySelector('.trade-chart-hover-line');
        const horizontalLine = document.querySelector('.trade-chart-hover-horizontal-line');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        const bounds = chart?._activeBacktestProbabilityGridBounds;
        const tooltipRect = tooltip?.getBoundingClientRect();
        const hoverLineRect = hoverLine?.getBoundingClientRect();
        const horizontalLineRect = horizontalLine?.getBoundingClientRect();
        const cellSignature = cells.map((cell) => [
            cell.dataset.column,
            cell.dataset.row,
            cell.dataset.horizon,
            cell.classList.contains('is-up') ? 'up' : 'down',
            cell.dataset.probability,
            cell.dataset.lowerPrice,
            cell.dataset.upperPrice,
            cell.dataset.opacity,
            cell.dataset.thresholdVisible,
        ].join(':'));
        return {
            activeIndex: bounds?.index ?? null,
            anchorX: bounds?.anchorX ?? null,
            anchorY: bounds?.anchorY ?? null,
            cellCount: cells.length,
            cellSignature,
            cellSize: bounds?.cellSize ?? null,
            columnCount: bounds?.columnCount ?? null,
            daysPerColumn: bounds?.daysPerColumn ?? null,
            gap: bounds?.gap ?? null,
            height: bounds?.height ?? null,
            intersectionX: bounds?.intersectionX ?? null,
            intersectionY: bounds?.intersectionY ?? null,
            rowCount: bounds?.rowCount ?? null,
            rowsAbove: bounds?.rowsAbove ?? null,
            rowsBelow: bounds?.rowsBelow ?? null,
            width: bounds?.width ?? null,
        };
    });

    const initial = await readSnapshot();
    expect(initial.activeIndex).toBeGreaterThanOrEqual(0);
    expect(initial.cellCount).toBe(initial.rowCount * initial.columnCount);
    expect(initial.activeIndex).toBe(await page.evaluate(() => {
        const chart = window.Chart?.getChart?.(document.querySelector('#tradePriceChart'));
        return (chart?.getDatasetMeta?.(0)?.data || []).length - 1;
    }));
    expect(initial.width).toBeGreaterThan(0);

    const fieldProbe = await page.evaluate(() => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const line = document.querySelector('.trade-chart-hover-horizontal-line');
        const tooltipRect = tooltip?.getBoundingClientRect();
        const stackRect = stack?.getBoundingClientRect();
        const lineRect = line?.getBoundingClientRect();
        if (!(tooltipRect instanceof DOMRect)
            || !(stackRect instanceof DOMRect)
            || !(lineRect instanceof DOMRect)) return null;
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const point = chart?.getDatasetMeta?.(0)?.data?.at(-1);
        const canvasRect = canvas?.getBoundingClientRect();
        const pan = Number(stack.dataset.probabilityPanVisualPosition || 0);
        const lastContentX = canvasRect.left - stackRect.left + pan
            + (point.x * canvasRect.width / chart.width);
        const lineY = lineRect.top + (lineRect.height / 2);
        const inset = Math.min(18, Math.max(6, tooltipRect.height / 4));
        return {
            // Sweep the endpoint plateau inside the viewport. The final point
            // follows the cursor; trailing field columns may remain clipped.
            leftX: stackRect.left
                + ((lastContentX + stackRect.width - tooltipRect.width) / 2) + 2,
            rightX: Math.min(stackRect.right - 4, stackRect.left + lastContentX - 1),
            upperY: Math.max(stackRect.top + 4, lineY - inset),
            lowerY: Math.min(stackRect.bottom - 4, lineY + inset),
        };
    });
    expect(fieldProbe).not.toBeNull();

    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const x = fieldProbe.leftX + ((fieldProbe.rightX - fieldProbe.leftX) * fraction);
        for (const y of [fieldProbe.upperY, fieldProbe.lowerY]) {
            await page.mouse.move(x, y);
            await expect.poll(readSnapshot).toEqual(initial);
            const lineX = await page.locator('.trade-chart-hover-line').boundingBox();
            expect(Math.abs(lineX.x + lineX.width / 2 - x)).toBeLessThan(1);
        }
    }
});
