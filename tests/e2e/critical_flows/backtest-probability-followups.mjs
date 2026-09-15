/* Code version: v1.1.0 */
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
test('keeps hidden Bayesian detail and equity canvases out of overview hover updates', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto(
        '/workspaces/backtest?range=3mo&strategy=bayesian-price-field'
        + '&show_trade_details=0&use_pe_ratio=0&cell_display_threshold=2.0',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'metrics');
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await expect(detailPanel).toBeHidden();

    const anchors = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        if (!(canvas instanceof HTMLCanvasElement) || !rect || !points.length) return [];
        const stride = Math.max(1, Math.floor(points.length / 16));
        return points
            .map((point, index) => (
                index % stride === 0 && Number.isFinite(point?.x) && Number.isFinite(point?.y)
                    ? {index, x: rect.left + point.x, y: rect.top + point.y}
                    : null
            ))
            .filter(Boolean);
    });
    if (!anchors.length) throw new Error('Bayesian overview hover anchors are unavailable.');

    await page.evaluate(() => {
        const detailGrid = document.querySelector('[data-backtest-probability-detail-grid]');
        const priceCanvas = document.querySelector('#tradePriceChart');
        const equityCanvas = document.querySelector('#tradeEquityChart');
        const priceChart = window.Chart?.getChart?.(priceCanvas);
        const equityChart = window.Chart?.getChart?.(equityCanvas);
        if (!(detailGrid instanceof HTMLElement) || !priceChart || !equityChart) {
            throw new Error('Bayesian hover performance probe targets are unavailable.');
        }
        const probe = {
            detailMutations: 0,
            equityDraws: 0,
            equityUpdates: 0,
            priceDraws: 0,
            priceUpdates: 0,
        };
        const observer = new MutationObserver((records) => {
            probe.detailMutations += records.length;
        });
        observer.observe(detailGrid, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
        });
        const wrapMethod = (chart, method, key) => {
            const originalMethod = chart[method].bind(chart);
            chart[method] = (...args) => {
                probe[key] += 1;
                return originalMethod(...args);
            };
        };
        wrapMethod(priceChart, 'draw', 'priceDraws');
        wrapMethod(priceChart, 'update', 'priceUpdates');
        wrapMethod(equityChart, 'draw', 'equityDraws');
        wrapMethod(equityChart, 'update', 'equityUpdates');
        window.__backtestHoverPerformanceProbe = {observer, probe};
    });

    for (const anchor of anchors) {
        const currentAnchor = await page.evaluate(({index}) => {
            const canvas = document.querySelector('#tradePriceChart');
            const chart = window.Chart?.getChart?.(canvas);
            const point = chart?.getDatasetMeta?.(0)?.data?.[index];
            const rect = canvas?.getBoundingClientRect();
            const chartWidth = Number(chart?.width);
            const chartHeight = Number(chart?.height);
            if (!(canvas instanceof HTMLCanvasElement) || !point || !rect
                || !(chartWidth > 0) || !(chartHeight > 0)
                || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
            return {
                x: rect.left + (point.x * (rect.width / chartWidth)),
                y: rect.top + (point.y * (rect.height / chartHeight)),
            };
        }, anchor);
        if (!currentAnchor) throw new Error('Bayesian hidden-detail hover anchor is unavailable.');
        await page.mouse.move(currentAnchor.x, currentAnchor.y);
    }
    await expect(page.locator('[data-backtest-chart-tooltip="probability-grid"]'))
        .toHaveClass(/is-visible/);
    await page.waitForTimeout(100);

    const probeResult = await page.evaluate(() => {
        const state = window.__backtestHoverPerformanceProbe;
        state?.observer?.disconnect?.();
        const panel = document.querySelector('#backtest_probability_detail_panel');
        const detailGrid = panel?.querySelector('[data-backtest-probability-detail-grid]');
        const tooltipGrid = document.querySelector(
            '[data-backtest-chart-tooltip="probability-grid"] [data-backtest-probability-grid]',
        );
        return {
            detailCellCount: detailGrid?.querySelectorAll('.backtest-probability-detail-cell').length || 0,
            detailMutations: state?.probe?.detailMutations || 0,
            equityDraws: state?.probe?.equityDraws || 0,
            equityUpdates: state?.probe?.equityUpdates || 0,
            panelHidden: panel instanceof HTMLElement ? panel.hidden : false,
            priceDraws: state?.probe?.priceDraws || 0,
            priceUpdates: state?.probe?.priceUpdates || 0,
            tooltipCellCount: tooltipGrid?.querySelectorAll('.backtest-probability-cell').length || 0,
        };
    });
    expect(probeResult.panelHidden).toBe(true);
    expect(probeResult.detailCellCount).toBe(0);
    expect(probeResult.detailMutations).toBe(0);
    expect(probeResult.equityDraws).toBe(0);
    expect(probeResult.equityUpdates).toBe(0);
    expect(probeResult.priceDraws).toBeGreaterThan(0);
    expect(probeResult.priceUpdates).toBe(0);
    expect(probeResult.tooltipCellCount).toBeGreaterThan(0);
});

test('keeps visible Bayesian detail hover updates out of shared layout reflow', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto(
        '/workspaces/backtest?range=3mo&strategy=bayesian-price-field'
        + '&show_trade_details=0&use_pe_ratio=0&cell_display_threshold=2.0',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    await page.locator('label[for="backtest_history_probability"]').click();
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await expect(detailPanel).toBeVisible();
    await expect.poll(() => detailPanel.locator('.backtest-probability-detail-cell').count())
        .toBeGreaterThan(0);

    const anchors = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        if (!(canvas instanceof HTMLCanvasElement) || !rect || !points.length) return [];
        const stride = Math.max(1, Math.floor(points.length / 12));
        return points
            .map((point, index) => (
                index % stride === 0 && Number.isFinite(point?.x) && Number.isFinite(point?.y)
                    ? {index, x: rect.left + point.x, y: rect.top + point.y}
                    : null
            ))
            .filter(Boolean);
    });
    if (!anchors.length) throw new Error('Visible Bayesian detail hover anchors are unavailable.');

    await page.evaluate(() => {
        const bootstrap = window.WORTHWARD_BOOTSTRAP;
        const originalRefresh = bootstrap?.backtestChartLayoutRefresh;
        if (typeof originalRefresh !== 'function') {
            throw new Error('Backtest shared chart refresh callback is unavailable.');
        }
        const probe = {sharedResizeCallbacks: 0};
        bootstrap.backtestChartLayoutRefresh = (...args) => {
            probe.sharedResizeCallbacks += 1;
            return originalRefresh(...args);
        };
        window.__backtestVisibleDetailPerformanceProbe = {probe};
    });
    for (const anchor of anchors) {
        const currentAnchor = await page.evaluate(({index}) => {
            const canvas = document.querySelector('#tradePriceChart');
            const chart = window.Chart?.getChart?.(canvas);
            const point = chart?.getDatasetMeta?.(0)?.data?.[index];
            const rect = canvas?.getBoundingClientRect();
            const chartWidth = Number(chart?.width);
            const chartHeight = Number(chart?.height);
            if (!(canvas instanceof HTMLCanvasElement) || !point || !rect
                || !(chartWidth > 0) || !(chartHeight > 0)
                || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
            return {
                x: rect.left + (point.x * (rect.width / chartWidth)),
                y: rect.top + (point.y * (rect.height / chartHeight)),
            };
        }, anchor);
        if (!currentAnchor) throw new Error('Bayesian visible-detail hover anchor is unavailable.');
        await page.mouse.move(currentAnchor.x, currentAnchor.y);
    }
    await expect(page.locator('[data-backtest-chart-tooltip="probability-grid"]'))
        .toHaveClass(/is-visible/);
    await page.waitForTimeout(100);

    const probeResult = await page.evaluate(() => {
        const state = window.__backtestVisibleDetailPerformanceProbe;
        const panel = document.querySelector('#backtest_probability_detail_panel');
        const grid = panel?.querySelector('[data-backtest-probability-detail-grid]');
        return {
            activeIndex: Number(panel?.dataset.activeIndex),
            detailCellCount: grid?.querySelectorAll('.backtest-probability-detail-cell').length || 0,
            sharedResizeCallbacks: state?.probe?.sharedResizeCallbacks || 0,
            panelHidden: panel instanceof HTMLElement ? panel.hidden : true,
            xTickCount: panel?.querySelectorAll('[data-backtest-probability-detail-x-tick]').length || 0,
            yTickCount: panel?.querySelectorAll('.backtest-probability-detail-y-tick').length || 0,
        };
    });
    expect(probeResult.panelHidden).toBe(false);
    expect(Number.isInteger(probeResult.activeIndex)).toBe(true);
    expect(probeResult.detailCellCount).toBeGreaterThan(0);
    expect(probeResult.sharedResizeCallbacks).toBe(0);
    expect(probeResult.xTickCount).toBeGreaterThan(0);
    expect(probeResult.yTickCount).toBe(5);
});

test('renders the complete Bayesian detail row lattice when hover reaches a chart edge', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto(
        '/workspaces/backtest?range=3mo&strategy=bayesian-price-field'
        + '&show_trade_details=0&use_pe_ratio=0&cell_display_threshold=2.0',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    await page.locator('label[for="backtest_history_probability"]').click();
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await expect(detailPanel).toBeVisible();
    await expect.poll(() => detailPanel.locator('.backtest-probability-detail-cell').count())
        .toBeGreaterThan(0);

    const edgeAnchor = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        if (!(canvas instanceof HTMLCanvasElement) || !rect || !chart?.chartArea || !points.length) {
            return null;
        }
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        // Warmup points have no forecast; choose a forecastable chart-edge origin.
        const point = points
            .filter((candidate, index) => (
                Number.isFinite(candidate?.x) && Number.isFinite(candidate?.y)
                && Number.isFinite(presentation?.predictive_mean?.[index])
                && Number.isFinite(presentation?.predictive_scale?.[index])
                && presentation.predictive_scale[index] > 0
            ))
            .reduce((closest, candidate) => {
                if (!closest) return candidate;
                const candidateDistance = Math.min(
                    Math.abs(candidate.y - chart.chartArea.top),
                    Math.abs(chart.chartArea.bottom - candidate.y),
                );
                const closestDistance = Math.min(
                    Math.abs(closest.y - chart.chartArea.top),
                    Math.abs(chart.chartArea.bottom - closest.y),
                );
                return candidateDistance < closestDistance ? candidate : closest;
            }, null);
        return point ? {
            x: rect.left + (point.x * (rect.width / chart.width)),
            y: rect.top + (point.y * (rect.height / chart.height)),
        } : null;
    });
    expect(edgeAnchor).not.toBeNull();
    await page.mouse.move(edgeAnchor.x, edgeAnchor.y);
    await expect(page.locator('[data-backtest-chart-tooltip="probability-grid"]'))
        .toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => (
        Number(document.querySelector('#backtest_probability_detail_panel')?.dataset.rowCount) || 0
    ))).toBe(24);

    const lattice = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const detailPanel = document.querySelector('#backtest_probability_detail_panel');
        const detailGrid = detailPanel?.querySelector('[data-backtest-probability-detail-grid]');
        const viewport = detailGrid?.parentElement;
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const bounds = chart?._activeBacktestProbabilityGridBounds;
        const detailRect = detailGrid?.getBoundingClientRect();
        const viewportRect = viewport?.getBoundingClientRect();
        const cells = Array.from(detailGrid?.querySelectorAll('.backtest-probability-detail-cell') || []);
        return {
            detailBottomInset: viewportRect && detailRect ? viewportRect.bottom - detailRect.bottom : Number.NaN,
            detailCellCount: cells.length,
            detailRows: Number(detailGrid?.dataset.rowCount),
            detailTopInset: viewportRect && detailRect ? detailRect.top - viewportRect.top : Number.NaN,
            hoverRows: Number(bounds?.rowCount),
            hoverRowsAbove: Number(bounds?.rowsAbove),
            hoverRowsBelow: Number(bounds?.rowsBelow),
            requestedRows: Number(presentation?.rows_above) + Number(presentation?.rows_below),
            columns: Number(detailGrid?.dataset.columnCount),
            tooltipVisible: tooltip?.classList.contains('is-visible'),
        };
    });
    expect(lattice.tooltipVisible).toBe(true);
    expect(lattice.requestedRows).toBe(24);
    expect(lattice.hoverRows).toBeLessThan(lattice.requestedRows);
    expect(lattice.hoverRowsAbove + lattice.hoverRowsBelow).toBe(lattice.hoverRows);
    expect(lattice.detailRows).toBe(lattice.requestedRows);
    expect(lattice.detailCellCount).toBe(lattice.detailRows * lattice.columns);
    expect(lattice.columns).toBe(20);
    expect(lattice.detailTopInset).toBeGreaterThanOrEqual(-1);
    expect(lattice.detailBottomInset).toBeGreaterThanOrEqual(-1);
});

test('renders the reusable 20-column by 24-row detail lattice at 732 by 1232', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 732, height: 1232});
    await page.goto(
        '/workspaces/backtest?ticker=QQQ&range=5y&strategy=bayesian-price-field'
        + '&cell_display_threshold=2.50&training_window=30&chip_window=41'
        + '&prior_strength=1.51&show_trade_details=0',
    );
    await expect.poll(() => page.evaluate(() => {
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        return presentation
            ? [presentation.columns, presentation.rows_above, presentation.rows_below]
            : null;
    }), {timeout: 60_000}).toEqual([20, 12, 12]);

    await page.locator('label[for="backtest_history_probability"]').click();
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel).toHaveAttribute('data-column-count', '20');
    await expect(detailPanel).toHaveAttribute('data-row-count', '24');
    const detailGrid = detailPanel.locator('[data-backtest-probability-detail-grid]');
    await expect.poll(() => detailGrid.locator('.backtest-probability-detail-cell').count())
        .toBe(480);

    const geometry = await detailGrid.evaluate((grid) => {
        const viewport = grid.parentElement;
        const cells = Array.from(grid.querySelectorAll('.backtest-probability-detail-cell'));
        const findCell = (row, column) => cells.find((cell) => (
            Number(cell.dataset.row) === row && Number(cell.dataset.column) === column
        ));
        const firstRect = findCell(0, 0)?.getBoundingClientRect();
        const nextColumnRect = findCell(0, 1)?.getBoundingClientRect();
        const nextRowRect = findCell(1, 0)?.getBoundingClientRect();
        const lastColumnRect = findCell(0, 19)?.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const viewportRect = viewport?.getBoundingClientRect();
        const xAxis = grid.closest('.backtest-probability-detail-main')
            ?.querySelector('[data-backtest-probability-detail-x-axis]');
        const xAxisRect = xAxis?.getBoundingClientRect();
        const tickRects = Array.from(
            xAxis?.querySelectorAll('.backtest-probability-detail-x-tick') || [],
            (tick) => tick.getBoundingClientRect(),
        ).sort((left, right) => left.left - right.left);
        return {
            bottomInset: viewportRect ? viewportRect.bottom - gridRect.bottom : Number.NaN,
            cellCount: cells.length,
            columns: new Set(cells.map((cell) => cell.dataset.column)).size,
            firstColumnInset: firstRect ? firstRect.left - gridRect.left : Number.NaN,
            horizontalGap: firstRect && nextColumnRect
                ? nextColumnRect.left - firstRect.right
                : Number.NaN,
            leftInset: viewportRect ? gridRect.left - viewportRect.left : Number.NaN,
            minimumCellHeight: Math.min(...cells.map((cell) => cell.getBoundingClientRect().height)),
            minimumCellWidth: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
            lastColumnInset: lastColumnRect ? gridRect.right - lastColumnRect.right : Number.NaN,
            rightInset: viewportRect ? viewportRect.right - gridRect.right : Number.NaN,
            rows: new Set(cells.map((cell) => cell.dataset.row)).size,
            squareDelta: Math.max(...cells.map((cell) => {
                const rect = cell.getBoundingClientRect();
                return Math.abs(rect.width - rect.height);
            })),
            topInset: viewportRect ? gridRect.top - viewportRect.top : Number.NaN,
            tickCount: tickRects.length,
            tickLeftInset: xAxisRect && tickRects.length
                ? Math.min(...tickRects.map((rect) => rect.left - xAxisRect.left))
                : Number.NaN,
            tickOverlap: tickRects.some((rect, index) => (
                index > 0 && tickRects[index - 1].right > rect.left + 0.5
            )),
            tickRightInset: xAxisRect && tickRects.length
                ? Math.min(...tickRects.map((rect) => xAxisRect.right - rect.right))
                : Number.NaN,
            upRows: new Set(cells.filter((cell) => cell.classList.contains('is-up'))
                .map((cell) => cell.dataset.row)).size,
            downRows: new Set(cells.filter((cell) => cell.classList.contains('is-down'))
                .map((cell) => cell.dataset.row)).size,
            verticalGap: firstRect && nextRowRect
                ? nextRowRect.top - firstRect.bottom
                : Number.NaN,
        };
    });
    expect(geometry.cellCount).toBe(480);
    expect(geometry.columns).toBe(20);
    expect(geometry.rows).toBe(24);
    expect(geometry.upRows).toBe(12);
    expect(geometry.downRows).toBe(12);
    expect(geometry.minimumCellWidth).toBeGreaterThan(0);
    expect(geometry.minimumCellHeight).toBeGreaterThan(0);
    expect(geometry.squareDelta).toBeLessThanOrEqual(0.1);
    expect(geometry.horizontalGap).toBeCloseTo(2, 1);
    expect(geometry.verticalGap).toBeCloseTo(2, 1);
    expect(geometry.topInset).toBeGreaterThanOrEqual(-1);
    expect(geometry.bottomInset).toBeGreaterThanOrEqual(-1);
    expect(geometry.leftInset).toBeGreaterThanOrEqual(-1);
    expect(geometry.rightInset).toBeGreaterThanOrEqual(-1);
    expect(geometry.firstColumnInset).toBeGreaterThanOrEqual(-1);
    expect(geometry.lastColumnInset).toBeGreaterThanOrEqual(-1);
    expect(geometry.tickCount).toBeGreaterThan(1);
    expect(geometry.tickOverlap).toBe(false);
    expect(geometry.tickLeftInset).toBeGreaterThanOrEqual(-1);
    expect(geometry.tickRightInset).toBeGreaterThanOrEqual(-1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
        .toBeLessThanOrEqual(0);
});

test('shows the full cumulative probability for a hovered Bayesian detail row', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto(
        '/workspaces/backtest?range=3mo&strategy=bayesian-price-field'
        + '&show_trade_details=0&cell_display_threshold=2.0',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    await page.locator('label[for="backtest_history_probability"]').click();
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    const detailGrid = detailPanel.locator('[data-backtest-probability-detail-grid]');
    const detailStatus = detailPanel.locator('[data-backtest-probability-detail-status]');
    await expect(detailPanel).toBeVisible();
    await expect.poll(() => detailGrid.locator('.backtest-probability-detail-cell').count())
        .toBeGreaterThan(0);
    const baseStatus = await detailStatus.textContent();
    expect(baseStatus).toMatch(/^Selected date: \d{1,2} [A-Z][a-z]{2} \d{4}$/);

    const sideSummary = await page.evaluate(() => {
        const cells = Array.from(
            document.querySelectorAll(
                '[data-backtest-probability-detail-grid] .backtest-probability-detail-cell',
            ),
        );
        const summarize = (sign) => {
            const horizons = new Map();
            cells
                .forEach((cell) => {
                    const horizon = Number(cell.dataset.horizon);
                    const entry = horizons.get(horizon) || {probability: 0, total: 0, hiddenCellCount: 0};
                    const mass = Math.max(0, Number(cell.dataset.probability) || 0);
                    entry.total += mass;
                    if (cell.classList.contains(`is-${sign}`)) {
                        entry.probability += mass;
                        entry.hiddenCellCount += cell.dataset.thresholdVisible === 'false' ? 1 : 0;
                    }
                    horizons.set(horizon, entry);
                });
            const valid = [...horizons.values()].filter((entry) => entry.total > 0);
            const forecastHorizonCount = valid.length;
            return {
                probability: forecastHorizonCount
                    ? valid.reduce((sum, entry) => sum + entry.probability / entry.total, 0)
                        / forecastHorizonCount
                    : 0,
                hiddenCellCount: [...horizons.values()]
                    .reduce((sum, entry) => sum + entry.hiddenCellCount, 0),
                forecastHorizonCount,
            };
        };
        const format = (value) => `${new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value * 100)}%`;
        const up = summarize('up');
        const down = summarize('down');
        return {
            upProbability: up.probability,
            upText: format(Math.round(up.probability * 10000) / 10000),
            downProbability: down.probability,
            downText: format((10000 - Math.round(up.probability * 10000)) / 10000),
            forecastHorizonCount: up.forecastHorizonCount,
            hiddenCellCount: up.hiddenCellCount + down.hiddenCellCount,
        };
    });
    await expect(detailPanel.locator('[data-backtest-probability-detail-up-summary]'))
        .toHaveText(sideSummary.upText);
    await expect(detailPanel.locator('[data-backtest-probability-detail-down-summary]'))
        .toHaveText(sideSummary.downText);
    expect(sideSummary.upText).toMatch(/^\d{1,3}(?:,\d{3})*\.\d{2}%$/);
    expect(sideSummary.downText).toMatch(/^\d{1,3}(?:,\d{3})*\.\d{2}%$/);
    expect(sideSummary.forecastHorizonCount).toBeGreaterThan(0);
    expect(sideSummary.upProbability).toBeLessThanOrEqual(1);
    expect(sideSummary.downProbability).toBeLessThanOrEqual(1);
    expect(Number.parseFloat(sideSummary.upText) + Number.parseFloat(sideSummary.downText)).toBeCloseTo(100, 10);
    expect(sideSummary.hiddenCellCount).toBeGreaterThan(0);
    const sideSummaryGeometry = await page.evaluate(() => {
        const anchor = document.querySelector('[data-backtest-probability-detail-anchor]')?.getBoundingClientRect();
        const up = document.querySelector('[data-backtest-probability-detail-up-summary]')?.getBoundingClientRect();
        const down = document.querySelector('[data-backtest-probability-detail-down-summary]')?.getBoundingClientRect();
        return anchor && up && down ? {
            anchorRight: anchor.right,
            anchorTop: anchor.top,
            anchorBottom: anchor.bottom,
            upRight: up.right,
            upBottom: up.bottom,
            downRight: down.right,
            downTop: down.top,
        } : null;
    });
    expect(sideSummaryGeometry).not.toBeNull();
    expect(Math.abs(sideSummaryGeometry.upRight - sideSummaryGeometry.anchorRight)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sideSummaryGeometry.downRight - sideSummaryGeometry.anchorRight)).toBeLessThanOrEqual(0.5);
    expect(sideSummaryGeometry.upBottom).toBeLessThanOrEqual(sideSummaryGeometry.anchorTop + 0.5);
    expect(sideSummaryGeometry.downTop).toBeGreaterThanOrEqual(sideSummaryGeometry.anchorBottom - 0.5);

    const rowProbe = await page.evaluate(() => {
        const grid = document.querySelector('[data-backtest-probability-detail-grid]');
        const rows = new Map();
        Array.from(grid?.querySelectorAll('.backtest-probability-detail-cell') || []).forEach((cell) => {
            const row = Number(cell.dataset.row);
            if (!Number.isInteger(row)) return;
            const entry = rows.get(row) || {row, cells: []};
            entry.cells.push(cell);
            rows.set(row, entry);
        });
        return [...rows.values()]
            .map((entry) => ({
                row: entry.row,
                hoverColumn: Number(entry.cells.find((cell) => cell.dataset.thresholdVisible === 'true')?.dataset.column),
                hiddenCellCount: entry.cells.filter((cell) => cell.dataset.thresholdVisible === 'false').length,
                visibleCellCount: entry.cells.filter((cell) => cell.dataset.thresholdVisible === 'true').length,
            }))
            .find((entry) => entry.hiddenCellCount > 0 && entry.visibleCellCount > 0) || null;
    });
    expect(rowProbe).not.toBeNull();

    const expected = await page.evaluate(({row}) => {
        const cells = Array.from(
            document.querySelectorAll(
                `[data-backtest-probability-detail-grid] .backtest-probability-detail-cell[data-row="${row}"]`,
            ),
        );
        const formatPrice = (value) => new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
        const lowerPrice = Math.min(...cells.map((cell) => Number(cell.dataset.lowerPrice)));
        const upperPrice = Math.max(...cells.map((cell) => Number(cell.dataset.upperPrice)));
        const cumulativeProbability = cells.reduce(
            (sum, cell) => sum + Number(cell.dataset.probability),
            0,
        );
        const hiddenCellCount = cells.filter(
            (cell) => cell.dataset.thresholdVisible === 'false',
        ).length;
        return {
            text: [
                `Price interval: ${formatPrice(lowerPrice)}–${formatPrice(upperPrice)}`,
                `Cumulative probability across all ${cells.length} forecast cells: ${(cumulativeProbability * 100).toFixed(2)}%`,
                `including ${hiddenCellCount} hidden`,
            ].join(' · '),
        };
    }, rowProbe);

    const rowCell = detailGrid.locator(
        `.backtest-probability-detail-cell[data-row="${rowProbe.row}"][data-column="${rowProbe.hoverColumn}"]`,
    );
    await rowCell.scrollIntoViewIfNeeded();
    const hoverHit = await page.evaluate(({row, column}) => {
        const cell = document.querySelector(
            `[data-backtest-probability-detail-grid] .backtest-probability-detail-cell[data-row="${row}"][data-column="${column}"]`,
        );
        const cellRect = cell?.getBoundingClientRect() || null;
        const point = cellRect ? {
            x: cellRect.left + (cellRect.width / 2),
            y: cellRect.top + (cellRect.height / 2),
        } : null;
        const hit = point ? document.elementFromPoint(point.x, point.y) : null;
        return Boolean(cell && hit?.closest('.backtest-probability-detail-cell') === cell);
    }, {row: rowProbe.row, column: rowProbe.hoverColumn});
    expect(hoverHit).toBe(true);
    const rowCellBox = await rowCell.boundingBox();
    expect(rowCellBox).not.toBeNull();
    const baseCellTitle = await rowCell.getAttribute('title');
    await page.mouse.move(
        rowCellBox.x + (rowCellBox.width / 2),
        rowCellBox.y + (rowCellBox.height / 2),
    );
    await expect(detailGrid).toHaveAttribute('data-hovered-row', String(rowProbe.row));
    await expect(detailGrid).toHaveAttribute('data-hover-summary', expected.text);
    await expect(rowCell).toHaveAttribute('title', expected.text);
    await expect(detailStatus).toHaveText(baseStatus);
    await expect.poll(() => detailGrid.locator('.is-row-hovered').count())
        .toBe(20);

    await page.mouse.move(12, 12);
    await expect.poll(() => detailGrid.getAttribute('data-hovered-row')).toBeNull();
    await expect(detailStatus).toHaveText(baseStatus);
    await expect(rowCell).toHaveAttribute('title', baseCellTitle);

    await page.setViewportSize({width: 390, height: 844});
    await setSidebarExpanded(page, false);
    await expect(detailPanel).toBeVisible();
    await expect.poll(() => detailGrid.locator('.backtest-probability-detail-cell').count())
        .toBeGreaterThan(0);
    const narrowOverflow = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelOverflow: document.querySelector('#backtest_probability_detail_panel')?.scrollWidth
            - document.querySelector('#backtest_probability_detail_panel')?.clientWidth,
        statusRight: document.querySelector('[data-backtest-probability-detail-status]')?.getBoundingClientRect().right,
        panelRight: document.querySelector('#backtest_probability_detail_panel')?.getBoundingClientRect().right,
    }));
    expect(narrowOverflow.documentOverflow).toBeLessThanOrEqual(1);
    expect(narrowOverflow.panelOverflow).toBeLessThanOrEqual(1);
    expect(narrowOverflow.statusRight).toBeLessThanOrEqual(narrowOverflow.panelRight + 1);
});

test('keeps available Bayesian ranges near the three-month price-field cell size', async ({page}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({width: 1021, height: 841});

    const readHoverGeometry = async (range) => {
        await page.goto(`/workspaces/backtest?ticker=NVDA&range=${range}&strategy=bayesian-price-field`);
        await page.waitForFunction(() => Boolean(
            window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
        ));
        const anchor = await page.evaluate(() => {
            const canvas = document.querySelector('#tradePriceChart');
            const chart = window.Chart?.getChart?.(canvas);
            const points = chart?.getDatasetMeta?.(0)?.data || [];
            const rect = canvas?.getBoundingClientRect();
            const index = Math.round((points.length - 1) * 0.5);
            const point = points[index];
            return point && rect ? {
                x: rect.left + (point.x * (rect.width / chart.width)),
                y: rect.top + (point.y * (rect.height / chart.height)),
            } : null;
        });
        expect(anchor, `${range} hover anchor`).not.toBeNull();
        await page.mouse.move(anchor.x, anchor.y);
        await expect.poll(() => page.evaluate(() => {
            const chart = window.Chart?.getChart?.(document.querySelector('#tradePriceChart'));
            return chart?._activeBacktestProbabilityGridBounds?.cellSize || 0;
        })).toBeGreaterThan(0);
        return page.evaluate(() => {
            const chart = window.Chart?.getChart?.(document.querySelector('#tradePriceChart'));
            const bounds = chart?._activeBacktestProbabilityGridBounds;
            return bounds ? {
                cellSize: bounds.cellSize,
                cellSizeTarget: bounds.cellSizeTarget,
                columns: bounds.columnCount,
                daysPerColumn: bounds.daysPerColumn,
                gap: bounds.gap,
                slotWidth: bounds.slotWidth,
                stepPixels: bounds.stepPixels,
                yAxisTitleCount: document.querySelectorAll(
                    '.backtest-probability-detail-y-axis-title',
                ).length,
            } : null;
        });
    };

    const geometries = new Map();
    for (const range of ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']) {
        geometries.set(range, await readHoverGeometry(range));
    }
    const reference = geometries.get('3mo');
    expect(reference).not.toBeNull();
    for (const [range, geometry] of geometries) {
        expect(geometry, `${range} geometry`).not.toBeNull();
        expect(geometry.yAxisTitleCount, `${range} y-axis title`).toBe(0);
        expect(geometry.columns, `${range} columns`).toBe(20);
        expect(Number.isInteger(geometry.daysPerColumn), `${range} day lattice`).toBe(true);
        expect(geometry.cellSize + geometry.gap).toBeCloseTo(geometry.slotWidth, 6);
        expect(geometry.cellSize, `${range} cell size should not undershoot 3mo`)
            .toBeGreaterThanOrEqual(reference.cellSize - 1e-9);
        expect(geometry.cellSize - reference.cellSize, `${range} cell-size delta`)
            .toBeLessThan(geometry.stepPixels + 1e-6);
        expect(geometry.cellSizeTarget, `${range} target cell size`).toBeGreaterThan(0);
        expect(geometry.cellSize, `${range} should honor its target cell size`)
            .toBeGreaterThanOrEqual(geometry.cellSizeTarget - 1e-9);
    }
});
