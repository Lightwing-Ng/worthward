/* Code version: v1.0.0 */
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
test('aligns the Backtest page and Performance result titles on the shared desktop centerline', async ({page}) => {
    await page.setViewportSize({width: 974, height: 1_354});
    await page.goto('/workspaces/backtest?stop_loss=0');

    const titleHeading = page.locator(
        'section#workspace_panel > section.workspace-mode-shell > article.report-card.workspace-article-card > div.report-heading-row',
    );
    const resultHeading = page.locator(
        '.backtest-workspace-main > .backtest-results-stack > .workspace-summary-card > .report-heading-row',
    );
    await expect(titleHeading).toHaveText('Backtest');
    await expect(resultHeading).toHaveText('Performance');

    const geometry = await page.evaluate(() => {
        const title = document.querySelector('.workspace-mode-title-card > .report-heading-row')?.getBoundingClientRect();
        const result = document.querySelector('.backtest-results-stack > .workspace-summary-card > .report-heading-row')?.getBoundingClientRect();
        const toggle = document.querySelector('#sidebar_toggle')?.getBoundingClientRect();
        const theme = document.querySelector('[data-layout-role="global-theme-anchor"]')?.getBoundingClientRect();
        if (!title || !result || !toggle || !theme) return null;
        const center = (rect) => rect.y + rect.height / 2;
        return {
            resultDelta: Math.abs(center(result) - center(title)),
            toggleDelta: Math.abs(center(toggle) - center(title)),
            themeDelta: Math.abs(center(theme) - center(title)),
        };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.resultDelta).toBeLessThanOrEqual(1);
    expect(geometry.toggleDelta).toBeLessThanOrEqual(1);
    expect(geometry.themeDelta).toBeLessThanOrEqual(1);
});

test('keeps the Bayesian Price Field axis column fixed and shares chart typography', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 974, height: 1_354});
    await page.goto(
        '/workspaces/backtest?ticker=DRAM&strategy=bayesian-price-field'
        + '&stop_loss=0&show_trade_details=0',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);

    await page.locator('label[for="backtest_history_probability"]').click();
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await expect(detailPanel).toBeVisible();
    await expect.poll(() => detailPanel.locator('.backtest-probability-detail-cell').count())
        .toBeGreaterThan(0);

    const geometry = await page.evaluate(() => {
        const rectFor = (element) => {
            if (!(element instanceof Element)) return null;
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            };
        };
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const yScale = chart?.scales?.y;
        const plot = document.querySelector('[data-backtest-probability-detail-plot]');
        const yAxis = document.querySelector('[data-backtest-probability-detail-y-axis]');
        const gridViewport = document.querySelector('[data-backtest-probability-detail-grid-viewport]');
        const xAxis = document.querySelector('[data-backtest-probability-detail-x-axis]');
        const yTick = document.querySelector('[data-backtest-probability-detail-y-tick]');
        const xTick = document.querySelector('[data-backtest-probability-detail-x-tick]');
        if (!canvas || !chart || !chart.chartArea || !yScale || !plot || !yAxis || !gridViewport || !xAxis || !yTick || !xTick) {
            return null;
        }
        const canvasRect = rectFor(canvas);
        const chartPlotLeft = canvasRect.left + chart.chartArea.left;
        const yTickStyle = getComputedStyle(yTick);
        const xTickStyle = getComputedStyle(xTick);
        return {
            chartPlotLeft,
            plot: rectFor(plot),
            yAxis: rectFor(yAxis),
            gridViewport: rectFor(gridViewport),
            xAxis: rectFor(xAxis),
            yTick: {
                rect: rectFor(yTick),
                fontFamily: yTickStyle.fontFamily,
                fontSize: yTickStyle.fontSize,
                fontWeight: yTickStyle.fontWeight,
                lineHeight: yTickStyle.lineHeight,
            },
            xTick: {
                rect: rectFor(xTick),
                fontFamily: xTickStyle.fontFamily,
                fontSize: xTickStyle.fontSize,
                fontWeight: xTickStyle.fontWeight,
                lineHeight: xTickStyle.lineHeight,
            },
            chartYAxisFont: yScale.options?.ticks?.font || null,
            chartYAxisPadding: Number(yScale.options?.ticks?.padding),
            chartYAxisRight: canvasRect.left + yScale.right,
        };
    });

    expect(geometry).not.toBeNull();
    expect(geometry.yAxis.width).toBeCloseTo(44, 0);
    expect(geometry.gridViewport.left).toBeCloseTo(geometry.yAxis.right, 0);
    expect(geometry.xAxis.left).toBeCloseTo(geometry.yAxis.right, 0);
    expect(geometry.yTick.rect.right).toBeCloseTo(
        geometry.yAxis.right - 8,
        0,
    );
    for (const font of [geometry.yTick, geometry.xTick]) {
        expect(font.fontFamily).toMatch(/BlinkMacSystemFont|system-ui/);
        expect(font.fontSize).toBe('12px');
        expect(font.fontWeight).toBe('400');
        expect(font.lineHeight).toBe('10px');
    }
    expect(geometry.chartYAxisFont.family).toMatch(/BlinkMacSystemFont|system-ui/);
    expect(geometry.chartYAxisFont.size).toBe(12);
    expect(String(geometry.chartYAxisFont.weight)).toBe('400');
});

test('renders matching Bayesian hover axis badges at the curve intersection', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto(
        '/workspaces/backtest?ticker=DRAM&strategy=bayesian-price-field'
        + '&stop_loss=0&show_trade_details=0',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);

    const readAnchor = () => page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        const candidates = points
            .map((point, index) => ({index, point}))
            .filter(({index, point}) => (
                Number.isFinite(point?.x)
                && Number.isFinite(point?.y)
                && Number.isFinite(Number(presentation?.predictive_mean?.[index]))
                && Number.isFinite(Number(presentation?.predictive_scale?.[index]))
            ));
        if (!(canvas instanceof HTMLCanvasElement) || !chart || !rect || !candidates.length) return null;
        const {index, point} = candidates[Math.floor(candidates.length / 2)];
        return {
            index,
            x: rect.left + (point.x * (rect.width / Number(chart.width))),
            y: rect.top + (point.y * (rect.height / Number(chart.height))),
        };
    });
    await expect.poll(readAnchor, {timeout: 10_000}).not.toBeNull();
    const anchor = await readAnchor();
    await page.mouse.move(anchor.x, anchor.y);
    await expect(page.locator('[data-backtest-chart-tooltip="probability-grid"]'))
        .toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart?.(document.querySelector('#tradePriceChart'));
        const label = document.querySelector('[data-backtest-hover-date-label]');
        const guide = chart?._activeBacktestPriceGuideBounds;
        return Boolean(
            label instanceof HTMLElement
            && !label.hidden
            && label.classList.contains('is-visible')
            && guide
            && Number.isFinite(guide.badgeLeft)
            && Number.isFinite(guide.badgeRight),
        );
    })).toBe(true);

    const badges = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const label = document.querySelector('[data-backtest-hover-date-label]');
        const verticalLine = document.querySelector('.trade-chart-hover-line');
        const horizontalLine = document.querySelector('.trade-chart-hover-horizontal-line');
        if (!(canvas instanceof HTMLCanvasElement)
            || !chart
            || !(label instanceof HTMLElement)
            || !(verticalLine instanceof HTMLElement)
            || !(horizontalLine instanceof HTMLElement)) return null;
        const labelRect = label.getBoundingClientRect();
        const verticalRect = verticalLine.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const guide = chart._activeBacktestPriceGuideBounds;
        const lines = Array.from(label.querySelectorAll('[data-backtest-hover-date-line]'))
            .map((line) => line.textContent?.trim() || '');
        const rawDate = window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates?.[guide?.index];
        const dateMatch = typeof rawDate === 'string'
            ? /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate)
            : null;
        const dateFormatter = window.WORTHWARD_BOOTSTRAP?.dateDisplay?.formatFullDateLines;
        const expectedLines = dateMatch && typeof dateFormatter === 'function'
            ? dateFormatter({
                year: Number(dateMatch[1]),
                monthIndex: Number(dateMatch[2]) - 1,
                day: Number(dateMatch[3]),
            }, {allowWrap: true}).filter(Boolean)
            : [];
        const style = getComputedStyle(label);
        const plotBottom = canvasRect.top + (chart.chartArea.bottom * (canvasRect.height / chart.height));
        return {
            background: style.backgroundColor,
            badgeBottom: guide.badgeBottom,
            badgeLeft: guide.badgeLeft,
            badgeRight: guide.badgeRight,
            badgeTop: guide.badgeTop,
            badgeValue: guide.value,
            color: style.color,
            dateCenterX: labelRect.left + (labelRect.width / 2),
            expectedLines,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            horizontalVisible: horizontalLine.classList.contains('is-visible'),
            lineCenterX: verticalRect.left + (verticalRect.width / 2),
            lineHeight: style.lineHeight,
            lines,
            topDelta: Math.abs(labelRect.top - plotBottom),
            verticalVisible: verticalLine.classList.contains('is-visible'),
        };
    });
    expect(badges).not.toBeNull();
    expect(badges.badgeLeft).toBeLessThan(badges.badgeRight);
    expect(badges.badgeTop).toBeLessThanOrEqual(badges.badgeBottom);
    expect(Number.isFinite(badges.badgeValue)).toBe(true);
    expect(badges.lines).toEqual(badges.expectedLines);
    expect(badges.lines).toEqual([
        expect.stringMatching(/^\d{1,2} [A-Z][a-z]{2}$/),
        expect.stringMatching(/^\d{4}$/),
    ]);
    expect(badges.background).toBe('rgb(0, 85, 204)');
    expect(badges.color).toBe('rgb(255, 255, 255)');
    expect(badges.fontFamily).toMatch(/BlinkMacSystemFont|system-ui/);
    expect(badges.fontSize).toBe('12px');
    expect(badges.lineHeight).toBe('10px');
    expect(badges.dateCenterX).toBeCloseTo(badges.lineCenterX, 1);
    expect(badges.topDelta).toBeLessThanOrEqual(1.5);
    expect(badges.horizontalVisible).toBe(true);
    expect(badges.verticalVisible).toBe(true);

    await page.mouse.move(1, 1);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart?.(document.querySelector('#tradePriceChart'));
        const label = document.querySelector('[data-backtest-hover-date-label]');
        const verticalLine = document.querySelector('.trade-chart-hover-line');
        const horizontalLine = document.querySelector('.trade-chart-hover-horizontal-line');
        return {
            dateVisible: label?.classList.contains('is-visible') || false,
            guideCleared: chart?._activeBacktestPriceGuideBounds == null,
            horizontalVisible: horizontalLine?.classList.contains('is-visible') || false,
            verticalVisible: verticalLine?.classList.contains('is-visible') || false,
        };
    })).toEqual({
        dateVisible: false,
        guideCleared: true,
        horizontalVisible: false,
        verticalVisible: false,
    });
});

test('keeps the Bayesian Price Field detail plot and date labels inside the history rail', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 1021, height: 841});
    await page.goto('/workspaces/backtest?ticker=NVDA&range=6mo&strategy=bayesian-price-field');
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);

    const historySurface = page.locator('#backtest_history_surface');
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(historySurface).toHaveAttribute('data-active-view', 'probability');
    await expect(detailPanel).toBeVisible();

    const readGeometry = () => page.evaluate(() => {
        const rectFor = (element) => {
            if (!(element instanceof Element)) return null;
            const rect = element.getBoundingClientRect();
            return {
                bottom: rect.bottom,
                height: rect.height,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                width: rect.width,
            };
        };
        const history = document.querySelector('#backtest_history_surface');
        const body = document.querySelector('#backtest_history_view_body');
        const panel = document.querySelector('#backtest_probability_detail_panel');
        const plot = document.querySelector('[data-backtest-probability-detail-plot]');
        const gridViewport = document.querySelector('[data-backtest-probability-detail-grid-viewport]');
        const grid = document.querySelector('[data-backtest-probability-detail-grid]');
        const xAxis = document.querySelector('[data-backtest-probability-detail-x-axis]');
        const xTicks = Array.from(document.querySelectorAll('[data-backtest-probability-detail-x-tick]'));
        const summaryValues = Array.from(document.querySelectorAll(
            '[data-backtest-probability-detail-up-summary],[data-backtest-probability-detail-down-summary]',
        ));
        return {
            body: rectFor(body),
            grid: rectFor(grid),
            gridViewport: rectFor(gridViewport),
            history: rectFor(history),
            panel: rectFor(panel),
            pageBlockOverflow: document.documentElement.scrollHeight
                - document.documentElement.clientHeight,
            plot: rectFor(plot),
            summaryFontSizes: summaryValues.map((element) => getComputedStyle(element).fontSize),
            xAxis: rectFor(xAxis),
            xTicks: xTicks.map(rectFor),
        };
    });
    const assertContained = (geometry) => {
        expect(geometry).not.toBeNull();
        expect(geometry.panel).not.toBeNull();
        expect(geometry.plot).not.toBeNull();
        expect(geometry.xAxis).not.toBeNull();
        expect(geometry.xTicks.length).toBeGreaterThan(0);
        expect(geometry.panel.left).toBeGreaterThanOrEqual(geometry.history.left - 1);
        expect(geometry.panel.right).toBeLessThanOrEqual(geometry.history.right + 1);
        expect(geometry.panel.top).toBeGreaterThanOrEqual(geometry.body.top - 1);
        expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.body.bottom + 1);
        expect(geometry.plot.left).toBeGreaterThanOrEqual(geometry.panel.left - 1);
        expect(geometry.plot.right).toBeLessThanOrEqual(geometry.panel.right + 1);
        expect(geometry.plot.top).toBeGreaterThanOrEqual(geometry.panel.top - 1);
        expect(geometry.plot.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
        expect(geometry.summaryFontSizes).toEqual(['17px', '17px']);
        expect(geometry.grid.top).toBeGreaterThanOrEqual(geometry.gridViewport.top - 1);
        expect(geometry.grid.bottom).toBeLessThanOrEqual(geometry.gridViewport.bottom + 1);
        expect(geometry.xAxis.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
        expect(geometry.xAxis.bottom).toBeLessThanOrEqual(geometry.body.bottom + 1);
        for (const tick of geometry.xTicks) {
            expect(tick.left).toBeGreaterThanOrEqual(geometry.panel.left - 1);
            expect(tick.right).toBeLessThanOrEqual(geometry.panel.right + 1);
            expect(tick.left).toBeGreaterThanOrEqual(geometry.history.left - 1);
            expect(tick.right).toBeLessThanOrEqual(geometry.history.right + 1);
            expect(tick.bottom).toBeLessThanOrEqual(geometry.xAxis.bottom + 1);
            expect(tick.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
        }
        expect(geometry.pageBlockOverflow).toBeLessThanOrEqual(0);
    };
    const expectContained = async () => {
        await expect.poll(async () => {
            const geometry = await readGeometry();
            return Boolean(
                geometry?.panel
                && geometry?.plot
                && geometry?.xAxis
                && geometry.panel.bottom <= geometry.body.bottom + 1
                && geometry.xAxis.bottom <= geometry.panel.bottom + 1,
            );
        }).toBe(true);
        assertContained(await readGeometry());
    };

    await expectContained();
    const sectionResizer = page.locator('#backtest_section_resizer');
    await sectionResizer.focus();
    const endKeepsDetailBudget = await page.evaluate(() => {
        const resizer = document.querySelector('#backtest_section_resizer');
        const history = document.querySelector('#backtest_history_surface');
        if (!(resizer instanceof HTMLElement) || !(history instanceof HTMLElement)) return false;
        const max = Number(resizer.getAttribute('aria-valuemax'));
        const now = Number(resizer.getAttribute('aria-valuenow'));
        const projectedHistory = history.getBoundingClientRect().height - (max - now);
        return projectedHistory >= 212;
    });
    if (endKeepsDetailBudget) {
        await sectionResizer.press('End');
        await expectContained();
    }
    await sectionResizer.press('Home');
    await expect.poll(() => page.evaluate(() => {
        const history = document.querySelector('#backtest_history_surface');
        const panel = document.querySelector('#backtest_probability_detail_panel');
        if (!(history instanceof HTMLElement) || !(panel instanceof HTMLElement)) return false;
        const historyRect = history.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        return panelRect.left >= historyRect.left - 1
            && panelRect.right <= historyRect.right + 1
            && panelRect.top >= historyRect.top - 1
            && panelRect.bottom <= historyRect.bottom + 1
            && document.documentElement.scrollHeight - document.documentElement.clientHeight <= 0;
    })).toBe(true);
});

test('pins the Bayesian overview origin on primary press, mouse click, and touch tap', async ({page}) => {
    test.setTimeout(60_000);
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto(
        '/workspaces/backtest?ticker=DRAM&strategy=bayesian-price-field'
        + '&stop_loss=0&show_trade_details=0',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);

    const priceCanvas = page.locator('#tradePriceChart');
    const probabilityTooltip = page.locator('[data-backtest-chart-tooltip="probability-grid"]');
    const readAnchor = (targetPage) => targetPage.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const candidates = points
            .map((point, index) => ({index, point}))
            .filter(({index, point}) => (
                Number.isFinite(point?.x)
                && Number.isFinite(point?.y)
                && Number.isFinite(Number(presentation?.predictive_mean?.[index]))
                && Number.isFinite(Number(presentation?.predictive_scale?.[index]))
            ));
        if (!(canvas instanceof HTMLCanvasElement) || !chart || !rect || !candidates.length) return null;
        const {index, point} = candidates[Math.floor(candidates.length / 2)];
        return {
            index,
            x: rect.left + (point.x * (rect.width / Number(chart.width))),
            y: rect.top + (point.y * (rect.height / Number(chart.height))),
        };
    });
    await expect.poll(() => readAnchor(page), {timeout: 10_000}).not.toBeNull();
    let anchor = await readAnchor(page);
    const pinnedIndex = async (label) => {
        await expect(probabilityTooltip).toHaveAttribute('data-pinned', 'true');
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
                ?._activeBacktestProbabilityGridBounds?.index
        )), {message: label}).toBe(anchor.index);
    };
    const clearPin = async () => {
        await page.keyboard.press('Escape');
        await expect(probabilityTooltip).toHaveAttribute('data-pinned', 'false');
        await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    };

    await page.mouse.move(anchor.x, anchor.y);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    anchor = await page.evaluate(({x}) => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart.getChart(canvas);
        const rect = canvas.getBoundingClientRect();
        const chartX = (Math.trunc(x) - rect.left) * chart.width / rect.width;
        const {point, index} = chart.getDatasetMeta(0).data
            .map((point, index) => ({point, index}))
            .filter(({point}) => Number.isFinite(point.x) && Number.isFinite(point.y))
            .reduce((best, candidate) => Math.abs(candidate.point.x - chartX)
                < Math.abs(best.point.x - chartX) ? candidate : best);
        return {x, index, y: rect.top + point.y * rect.height / chart.height};
    }, anchor);
    // Press on the visible curve after pan, not on its former screen position.
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    await pinnedIndex('A primary pointer press must pin before release');
    await page.mouse.up();
    await page.mouse.move(anchor.x + 30, anchor.y + 20);
    await pinnedIndex('Hover movement must not replace a pinned origin');
    await clearPin();

    anchor = await readAnchor(page);
    // Let pointer-driven pan settle before pressing the newly visible curve,
    // just as the primary-press assertion above does.
    await page.mouse.move(anchor.x, anchor.y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    anchor = await page.evaluate(({x}) => {
        const chart = window.Chart.getChart(document.querySelector('#tradePriceChart'));
        const rect = chart.canvas.getBoundingClientRect();
        const chartX = (Math.trunc(x) - rect.left) * chart.width / rect.width;
        const {point, index} = chart.getDatasetMeta(0).data
            .map((point, index) => ({point, index}))
            .filter(({point}) => Number.isFinite(point.x) && Number.isFinite(point.y))
            .reduce((best, candidate) => Math.abs(candidate.point.x - chartX)
                < Math.abs(best.point.x - chartX) ? candidate : best);
        return {x, index, y: rect.top + point.y * rect.height / chart.height};
    }, anchor);
    await page.mouse.click(anchor.x, anchor.y, {button: 'left'});
    await pinnedIndex('A normal mouse click must pin the origin');
    await page.mouse.click(anchor.x, anchor.y, {button: 'right'});
    const contextMenu = page.locator('#chart_context_menu');
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.locator('[data-chart-context-action="download-svg"]'))
        .toHaveText('Download SVG');
    await pinnedIndex('A right-click must preserve the pinned origin');
    await clearPin();

    const touchContext = await page.context().browser().newContext({
        hasTouch: true,
        viewport: {width: 1_024, height: 900},
    });
    const touchPage = await touchContext.newPage();
    try {
        const touchUrl = new URL('/workspaces/backtest?ticker=DRAM&strategy=bayesian-price-field'
            + '&stop_loss=0&show_trade_details=0', page.url()).href;
        await touchPage.goto(touchUrl);
        await expect.poll(() => touchPage.evaluate(() => Boolean(
            window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
        ))).toBe(true);
        await expect.poll(() => readAnchor(touchPage), {timeout: 10_000}).toBeTruthy();
        const touchAnchor = await readAnchor(touchPage);
        const touchTooltip = touchPage.locator('[data-backtest-chart-tooltip="probability-grid"]');
        await touchPage.touchscreen.tap(touchAnchor.x, touchAnchor.y);
        await expect(touchTooltip).toHaveAttribute('data-pinned', 'true');
        await expect.poll(() => touchPage.evaluate(() => (
            window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
                ?._activeBacktestProbabilityGridBounds?.index
        )), {message: 'A touch tap must pin the origin'}).toBe(touchAnchor.index);
    } finally {
        await touchContext.close();
    }

    await page.locator('label[for="backtest_history_probability"]').click();
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await expect(detailPanel).toBeVisible();
    await expect.poll(() => page.evaluate(() => Number(
        document.querySelector('#backtest_probability_detail_panel')?.dataset.activeIndex,
    ))).toBe(anchor.index);
    await priceCanvas.scrollIntoViewIfNeeded();
});

test('resizes the backtest overview and transaction history with the shared section handle', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?stop_loss=0');

    await expect.poll(() => page.locator('.backtest-results-stack').evaluate((stack) => (
        !stack.classList.contains('has-probability-field')
        && !stack.style.getPropertyValue('--backtest-probability-stage-min-height')
    ))).toBe(true);

    const handle = page.locator('#backtest_section_resizer');
    const exactHandle = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[2]/article/div/button',
    );
    const overview = page.locator('.backtest-trade-performance-card');
    const history = page.locator('#backtest_history_surface');
    await expect(handle).toBeVisible();
    await expect(exactHandle).toHaveCount(1);
    await expect(exactHandle).toHaveAttribute('id', 'backtest_section_resizer');

    const handleGeometry = await handle.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        lineHeight: getComputedStyle(element, '::before').height,
    }));
    expect(handleGeometry.height).toBe(10);
    expect(handleGeometry.lineHeight).toBe('1px');

    const before = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    await handle.focus();
    await handle.press('ArrowUp');
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight < beforeSize.overview && historyHeight > beforeSize.history;
    }, before)).toBe(true);
    const after = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    expect(after.overview).toBeLessThan(before.overview);
    expect(after.history).toBeGreaterThan(before.history);
    await expect.poll(() => handle.getAttribute('aria-valuenow')).not.toBe(String(Math.round(before.overview)));
    await expect(overview).toHaveJSProperty('hidden', false);
    await expect(history).toBeVisible();

    const pointerBefore = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Backtest section resizer did not have a clickable bounding box.');
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + (handleBox.width / 2),
        handleBox.y - 48,
    );
    await page.mouse.up();
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight < beforeSize.overview && historyHeight > beforeSize.history;
    }, pointerBefore)).toBe(true);
});

test('keeps the Backtest Metrics and Transactions resizer endpoints aligned', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=QQQ&range=1y&strategy=grid-trading');

    const resizer = page.locator('#backtest_section_resizer');
    const historySurface = page.locator('#backtest_history_surface');
    const readSplit = () => page.evaluate(() => {
        const readRect = (selector) => {
            const rect = document.querySelector(selector)?.getBoundingClientRect();
            return rect ? {top: rect.top, bottom: rect.bottom, height: rect.height} : null;
        };
        const handle = document.querySelector('#backtest_section_resizer');
        return {
            active: document.querySelector('#backtest_history_surface')?.dataset.activeView,
            resizer: {
                now: Number(handle?.getAttribute('aria-valuenow')),
                maximum: Number(handle?.getAttribute('aria-valuemax')),
            },
            overview: readRect('.backtest-trade-performance-card'),
            history: readRect('#backtest_history_surface'),
        };
    });
    const moveToEnd = async (view) => {
        await page.locator(`label[for="backtest_history_${view}"]`).click();
        await expect(historySurface).toHaveAttribute('data-active-view', view);
        await resizer.press('End');
        await expect.poll(async () => {
            const split = await readSplit();
            return split.resizer.now === split.resizer.maximum;
        }).toBe(true);
        return readSplit();
    };

    const metricsEnd = await moveToEnd('metrics');
    const transactionsEnd = await moveToEnd('transactions');

    expect(metricsEnd.resizer.maximum).toBe(transactionsEnd.resizer.maximum);
    expect(metricsEnd.resizer.now).toBe(transactionsEnd.resizer.now);
    expect(metricsEnd.overview.height).toBeCloseTo(transactionsEnd.overview.height, 0);
    expect(metricsEnd.history.top).toBeCloseTo(transactionsEnd.history.top, 0);
    expect(metricsEnd.history.height).toBeCloseTo(transactionsEnd.history.height, 0);
});

test('rebinds the backtest section handle after same-page result hydration', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&stop_loss=0');

    const handle = page.locator('#backtest_section_resizer');
    expect(new URL(page.url()).searchParams.get('stop_loss')).not.toBe('1');
    await expect(handle).toBeVisible();
    await expect(page.locator('#stop_loss')).not.toBeChecked();
    await page.locator('label[for="stop_loss"]').click();
    await expect(page.locator('#stop_loss')).toBeChecked();
    await expect.poll(() => page.url()).not.toContain('stop_loss=0');
    await expect(handle).toHaveAttribute('aria-valuenow', /\d+/);

    const before = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    await handle.focus();
    await handle.press('ArrowDown');
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight > beforeSize.overview && historyHeight < beforeSize.history;
    }, before)).toBe(true);

    const pointerBefore = await page.evaluate(() => ({
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height,
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height,
    }));
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Hydrated Backtest section resizer did not have a clickable bounding box.');
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + (handleBox.width / 2),
        handleBox.y - 48,
    );
    await page.mouse.up();
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overviewHeight = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const historyHeight = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overviewHeight < beforeSize.overview && historyHeight > beforeSize.history;
    }, pointerBefore)).toBe(true);
});

test('keeps the Backtest Metrics and Transactions pill synchronized', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=TQQQ&range=3y&strategy=supertrend-ai');

    const viewSegmented = page.locator('#backtest_history_view_segmented');
    const historyArticle = page.locator('#backtest_history_surface');
    await expect(page.locator('#backtest_view_segmented')).toHaveCount(0);
    await expect(page.locator('#backtest_view_surface')).toHaveAttribute('data-active-view', 'overview');
    await expect(page.locator('#backtest_overview_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_transactions_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeHidden();
    await expect(historyArticle.locator('.investment-history-heading-row')).toHaveCount(0);

    await page.locator('label[for="backtest_history_metrics"]').click();
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'metrics');
    await expect(page.locator('#backtest_history_metrics_panel')).toBeVisible();
    await expect(page.locator('#backtest_metrics_panel .trade-metric-card')).toHaveCount(10);
    await expect(page.locator('#backtest_history_transactions_panel')).toBeHidden();
    await expect.poll(() => viewSegmented.evaluate((element) => ({
        active: element.dataset.active,
        activeIndex: element.style.getPropertyValue('--segmented-active-index'),
    }))).toEqual({active: 'metrics', activeIndex: '0'});
    const centeredPill = await page.evaluate(() => {
        const surface = document.querySelector('#backtest_history_surface')?.getBoundingClientRect();
        const pill = document.querySelector('#backtest_history_view_segmented')?.getBoundingClientRect();
        return {
            centerDelta: Math.abs((pill.left + (pill.width / 2)) - (surface.left + (surface.width / 2))),
            leftGap: pill.left - surface.left,
            rightGap: surface.right - pill.right,
        };
    });
    expect(centeredPill.centerDelta).toBeLessThanOrEqual(1);
    expect(centeredPill.leftGap).toBeGreaterThanOrEqual(0);
    expect(centeredPill.rightGap).toBeGreaterThanOrEqual(0);

    const transactionPageSize = await page.evaluate(() => (
        window.WORTHWARD_LOCAL_STORE_PAGINATION?.LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE
    ));
    expect(transactionPageSize).toBe(100);
    expect(await historyArticle.locator('tbody tr').count()).toBeLessThanOrEqual(100);
    await page.locator('label[for="backtest_history_transactions"]').click();
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'transactions');
    await expect(page.locator('#backtest_history_transactions_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeHidden();
    await expect(historyArticle.locator('#tradeTransactionsPagination')).toBeHidden();

    await expect.poll(() => viewSegmented.evaluate((element) => (
        element.style.getPropertyValue('--segmented-active-index')
    ))).toBe('1');

    await page.setViewportSize({width: 390, height: 844});
    await expect(viewSegmented).toBeVisible();
    const narrowPill = await page.evaluate(() => {
        const surface = document.querySelector('#backtest_history_surface')?.getBoundingClientRect();
        const pill = document.querySelector('#backtest_history_view_segmented')?.getBoundingClientRect();
        return {
            leftGap: pill.left - surface.left,
            rightGap: surface.right - pill.right,
            width: pill.width,
        };
    });
    expect(narrowPill.width).toBeGreaterThan(0);
    expect(narrowPill.leftGap).toBeGreaterThanOrEqual(0);
    expect(narrowPill.rightGap).toBeGreaterThanOrEqual(0);
});

test('toggles the shared Backtest trade-details presentation without recomputing', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=QQQ&range=6mo&strategy=buy-and-hold');

    const detailsSwitch = page.locator('#show_trade_details');
    const viewSegmented = page.locator('#backtest_history_view_segmented');
    const chartStack = page.locator('.trade-chart-stack');
    const priceCanvas = page.locator('#tradePriceChart');
    const equityCanvas = page.locator('#tradeEquityChart');
    const transactionsInput = page.locator('#backtest_history_transactions');
    await expect(detailsSwitch).toBeChecked();
    await expect(chartStack).not.toHaveClass(/is-trade-details-hidden/);
    await expect(equityCanvas).toBeVisible();
    await expect(transactionsInput).toBeEnabled();
    await expect(transactionsInput).toBeChecked();

    const enabledGeometry = await page.evaluate(() => {
        const stack = document.querySelector('.trade-chart-stack');
        const price = document.querySelector('#tradePriceChart');
        const equity = document.querySelector('#tradeEquityChart');
        if (!(stack instanceof HTMLElement) || !(price instanceof HTMLElement) || !(equity instanceof HTMLElement)) return null;
        return {
            stackHeight: stack.getBoundingClientRect().height,
            priceHeight: price.getBoundingClientRect().height,
            equityHeight: equity.getBoundingClientRect().height,
        };
    });
    expect(enabledGeometry).not.toBeNull();

    await page.locator('label[for="show_trade_details"]').click();
    await expect(detailsSwitch).not.toBeChecked();
    await expect(chartStack).toHaveClass(/is-trade-details-hidden/);
    await expect(equityCanvas).toBeHidden();
    await expect(transactionsInput).toBeDisabled();
    await expect(page.locator('#backtest_history_metrics')).toBeChecked();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_transactions_panel')).toBeHidden();
    await expect(page.locator('[data-backtest-history-transactions-option]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'metrics');
    await expect(page).toHaveURL(/show_trade_details=0/);
    const disabledSegmentState = await viewSegmented.evaluate((element) => {
        const shell = element.getBoundingClientRect();
        const activeOption = element.querySelector('#backtest_history_metrics')?.closest('.segmented-control-option');
        const disabledOption = element.querySelector('#backtest_history_transactions')?.closest('.segmented-control-option');
        const activeRect = activeOption?.getBoundingClientRect();
        const disabledRect = disabledOption?.getBoundingClientRect();
        const disabledLabel = disabledOption?.querySelector('span');
        const thumb = getComputedStyle(element, '::before');
        return {
            optionCount: element.dataset.optionCount,
            columnCount: getComputedStyle(element).gridTemplateColumns.split(/\s+/).filter(Boolean).length,
            shellWidth: shell.width,
            activeWidth: activeRect?.width || 0,
            disabledWidth: disabledRect?.width || 0,
            activeTop: activeRect?.top || 0,
            disabledTop: disabledRect?.top || 0,
            disabledOpacity: getComputedStyle(disabledLabel).opacity,
            disabledPointerEvents: getComputedStyle(disabledLabel).pointerEvents,
            thumbWidth: Number.parseFloat(thumb.width) || 0,
        };
    });
    expect(disabledSegmentState).toMatchObject({
        optionCount: '2',
        columnCount: 2,
        disabledOpacity: '0.55',
        disabledPointerEvents: 'none',
    });
    expect(Math.abs(disabledSegmentState.activeWidth - disabledSegmentState.disabledWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(disabledSegmentState.activeTop - disabledSegmentState.disabledTop)).toBeLessThanOrEqual(1);
    expect(disabledSegmentState.thumbWidth).toBeLessThan(disabledSegmentState.shellWidth - 8);
    await page.setViewportSize({width: 390, height: 844});
    const narrowDisabledSegmentState = await viewSegmented.evaluate((element) => {
        const shell = element.getBoundingClientRect();
        const activeOption = element.querySelector('#backtest_history_metrics')?.closest('.segmented-control-option');
        const disabledOption = element.querySelector('#backtest_history_transactions')?.closest('.segmented-control-option');
        const activeRect = activeOption?.getBoundingClientRect();
        const disabledRect = disabledOption?.getBoundingClientRect();
        const thumb = getComputedStyle(element, '::before');
        return {
            shellWidth: shell.width,
            shellRight: shell.right,
            activeWidth: activeRect?.width || 0,
            disabledWidth: disabledRect?.width || 0,
            activeTop: activeRect?.top || 0,
            disabledTop: disabledRect?.top || 0,
            thumbWidth: Number.parseFloat(thumb.width) || 0,
        };
    });
    expect(narrowDisabledSegmentState.shellWidth).toBeGreaterThan(0);
    expect(narrowDisabledSegmentState.shellRight).toBeLessThanOrEqual(390);
    expect(Math.abs(narrowDisabledSegmentState.activeWidth - narrowDisabledSegmentState.disabledWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(narrowDisabledSegmentState.activeTop - narrowDisabledSegmentState.disabledTop)).toBeLessThanOrEqual(1);
    expect(narrowDisabledSegmentState.thumbWidth).toBeLessThan(narrowDisabledSegmentState.shellWidth - 8);
    await page.setViewportSize({width: 1024, height: 900});
    await page.locator('label[for="backtest_history_transactions"]').click({force: true});
    await expect(page.locator('#backtest_history_metrics')).toBeChecked();
    await expect(viewSegmented).toHaveAttribute('data-active', 'metrics');
    await expect.poll(() => page.evaluate((baseline) => {
        const stack = document.querySelector('.trade-chart-stack');
        const price = document.querySelector('#tradePriceChart');
        const equity = document.querySelector('#tradeEquityChart');
        if (!(stack instanceof HTMLElement) || !(price instanceof HTMLElement) || !(equity instanceof HTMLElement)) return false;
        const geometry = {
            stackHeight: stack.getBoundingClientRect().height,
            priceHeight: price.getBoundingClientRect().height,
            equityHeight: equity.getBoundingClientRect().height,
        };
        return baseline !== null
            && Math.abs(geometry.stackHeight - baseline.stackHeight) <= 1
            && geometry.priceHeight > baseline.priceHeight
            && geometry.equityHeight === 0;
    }, enabledGeometry)).toBe(true);

    const dateAxisRenderedOnPriceCanvas = await priceCanvas.evaluate((canvas) => {
        const chart = window.Chart?.getChart?.(canvas);
        if (!chart) return false;
        const context = chart.ctx;
        const originalFillText = context.fillText;
        const labels = [];
        context.fillText = function captureFillText(text, ...args) {
            labels.push(String(text));
            return originalFillText.call(this, text, ...args);
        };
        try {
            chart.draw();
        } finally {
            context.fillText = originalFillText;
        }
        return labels.some((label) => /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(label));
    });
    expect(dateAxisRenderedOnPriceCanvas).toBe(true);

    await page.locator('label[for="backtest_history_transactions"]').click({force: true});
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'metrics');
    await page.locator('label[for="show_trade_details"]').click();
    await expect(detailsSwitch).toBeChecked();
    await expect(equityCanvas).toBeVisible();
    await expect(transactionsInput).toBeEnabled();
    await expect(page).not.toHaveURL(/show_trade_details=0/);
    await page.locator('label[for="backtest_history_transactions"]').click();
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'transactions');
    await expect(page.locator('#backtest_history_transactions_panel')).toBeVisible();

});

test('keeps the Backtest interval pill aligned and static in the 1m state', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=DRAM&range=1d&interval=1m');

    const intervalShell = page.locator('#backtest_interval_control');
    await expect(intervalShell).toHaveAttribute('data-segmented-pill', 'measured');
    await expect(intervalShell.locator('#backtest_interval_1m')).toBeChecked();

    const pillState = await intervalShell.evaluate((element) => {
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
        const thumbLeft = shellRect.left + (Number.parseFloat(pseudo.left) || 0) + translateX;
        const thumbRight = thumbLeft + (Number.parseFloat(pseudo.width) || 0);
        return {
            transition: pseudo.transition,
            opacity: pseudo.opacity,
            leftDelta: activeRect ? Math.abs(thumbLeft - activeRect.left) : Number.POSITIVE_INFINITY,
            rightDelta: activeRect ? Math.abs(thumbRight - activeRect.right) : Number.POSITIVE_INFINITY,
            shellRight: shellRect.right,
            thumbRight,
        };
    });

    expect(pillState.transition).toBe('none');
    expect(pillState.opacity).toBe('1');
    expect(pillState.leftDelta).toBeLessThanOrEqual(1);
    expect(pillState.rightDelta).toBeLessThanOrEqual(1);
    expect(pillState.thumbRight).toBeLessThanOrEqual(pillState.shellRight + 1);
});

test('formats daily Backtest x-axis labels without a midnight time', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=QQQ&range=6mo&strategy=buy-and-hold');
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);

    const axisLabels = await page.evaluate(() => {
        const result = window.WORTHWARD_APP?.backtestResult;
        if (!result?.chart) throw new Error('Backtest chart shell is unavailable.');
        const renderLabels = (interval, rawDates) => {
            const close = rawDates.map((_value, index) => 100 + index);
            result.interval = interval;
            result.trades = [];
            result.chart = {
                ...(result.chart || {}),
                dates: [...rawDates],
                raw_dates: [...rawDates],
                open: close.map((value) => value - 1),
                high: close.map((value) => value + 1),
                low: close.map((value) => value - 2),
                close,
                equity: close.map((value) => 10_000 + value),
                all_in_equity: close.map((value) => 10_000 + value),
            };
            window.WORTHWARD_BOOTSTRAP.initBacktestWorkspace();
            const canvas = document.querySelector('#tradeEquityChart');
            const chart = window.Chart?.getChart?.(canvas);
            const plugin = chart?.config?._config?.plugins?.find((item) => item.id === 'tradeXAxisLabelPlugin');
            if (!(canvas instanceof HTMLCanvasElement) || !plugin) return [];
            const calls = [];
            plugin.afterDraw({
                canvas,
                ctx: {
                    save: () => {},
                    restore: () => {},
                    fillText: (text) => calls.push(String(text)),
                },
                chartArea: {bottom: 200},
                scales: {x: {getPixelForValue: (value) => Number(value) * 40}},
            });
            return calls;
        };
        return {
            daily: renderLabels('1d', [
                '2026-08-09 00:00',
                '2026-08-10 00:00',
                '2026-08-11 00:00',
                '2026-08-12 00:00',
            ]),
            intraday: renderLabels('1m', [
                '2026-08-09 09:30',
                '2026-08-09 09:31',
                '2026-08-09 09:32',
                '2026-08-09 09:33',
            ]),
        };
    });

    expect(axisLabels.daily).toContain('9 Aug');
    expect(axisLabels.daily).toContain('2026');
    expect(axisLabels.daily.every((label) => !label.includes('00:00'))).toBe(true);
    expect(axisLabels.intraday).toContain('2026 09:30');

    const dailyHoverPoint = await page.evaluate(() => {
        const result = window.WORTHWARD_APP?.backtestResult;
        if (!result?.chart) return null;
        const rawDates = [
            '2026-08-09 00:00',
            '2026-08-10 00:00',
            '2026-08-11 00:00',
            '2026-08-12 00:00',
        ];
        const close = rawDates.map((_value, index) => 100 + index);
        result.interval = '1d';
        result.trades = [];
        result.strategy_presentation = null;
        result.chart = {
            ...(result.chart || {}),
            dates: [...rawDates],
            raw_dates: [...rawDates],
            open: close.map((value) => value - 1),
            high: close.map((value) => value + 1),
            low: close.map((value) => value - 2),
            close,
            equity: close.map((value) => 10_000 + value),
            all_in_equity: close.map((value) => 10_000 + value),
        };
        window.WORTHWARD_BOOTSTRAP.initBacktestWorkspace();
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const point = chart?.getDatasetMeta?.(0)?.data?.[1];
        const rect = canvas?.getBoundingClientRect();
        if (!point || !rect || !chart?.width || !chart?.height) return null;
        return {
            x: rect.left + (point.x * (rect.width / chart.width)),
            y: rect.top + (point.y * (rect.height / chart.height)),
        };
    });
    expect(dailyHoverPoint).not.toBeNull();
    await page.mouse.move(dailyHoverPoint.x, dailyHoverPoint.y);
    const dailyTooltip = page.locator('[data-backtest-chart-tooltip="summary"]');
    await expect(dailyTooltip).toHaveClass(/is-visible/);
    await expect(dailyTooltip.locator('.chart-tooltip-date')).toHaveText('10 Aug 2026');
    await expect(dailyTooltip.locator('.chart-tooltip-date')).not.toContainText('00:00');
});

test('switches an unsupported 1 year Backtest period to the available 1m maximum', async ({page}) => {
    await page.setViewportSize({width: 972, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQ&range=1y&strategy=buy-and-hold');

    await expect(page.locator('#period')).toHaveValue('1y');
    await expect(page.locator('#stop_loss')).not.toBeChecked();
    await expect(page.locator('label[for="stop_loss"]')).toContainText('Allow algorithmic stop-loss exits');
    await expect.poll(() => page.evaluate(() => (
        window.WORTHWARD_APP?.backtestPeriodOptions?.['1m'] || []
    ))).toEqual(['1d', '3d', 'max']);
    await expect(page.locator('#backtest_interval_1m')).toBeEnabled();
    await page.locator('label[for="backtest_interval_1m"]').click();

    await expect(page.locator('#period')).toHaveValue('max');
    await expect(page).toHaveURL(/interval=1m/);
    await expect(page).toHaveURL(/range=max/);
    await expect(page.locator('#backtest_interval_1m')).toBeChecked();
});

test('intersects 1m availability across every required Backtest ticker', async ({page}) => {
    const presenceSnapshots = [];
    await page.route('**/api/market-store/presence?*', async (route) => {
        const tickers = new URL(route.request().url()).searchParams.getAll('ticker');
        presenceSnapshots.push(tickers);
        const periodOptions = Object.fromEntries(tickers.map((ticker) => [ticker, {
            '1d': ['1d', '1mo', '1y', 'max'],
            '1m': ticker === 'TQQQ' ? ['1d', 'max'] : ['1d', '3d', 'max'],
        }]));
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                tickers,
                missingHistory: [],
                has1m: Object.fromEntries(tickers.map((ticker) => [ticker, ticker !== 'TQQQ'])),
                periodOptions,
            }),
        });
    });

    await page.goto('/workspaces/backtest?ticker=QQQ&range=1y&strategy=buy-and-hold');
    await page.locator('#trade_strategy').evaluate((select) => {
        select.value = 'leveraged-rotation';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await expect.poll(() => presenceSnapshots.find((tickers) => tickers.length === 2) || null).toEqual([
        'QQQ',
        'TQQQ',
    ]);
    await expect.poll(() => page.evaluate(() => (
        window.WORTHWARD_APP?.backtestPeriodOptions?.['1m'] || []
    ))).toEqual(['1d', 'max']);
    await expect(page.locator('#backtest_interval_1m')).toBeDisabled();
    await expect(page.locator('label[for="backtest_interval_1m"]')).toBeVisible();
});

test('keeps the latest Backtest interval state when an older presence response arrives late', async ({page}) => {
    await page.goto(
        '/workspaces/backtest?ticker=QQQ&ticker=TQQQ&range=1y&strategy=leveraged-rotation',
    );
    const hydrationHtml = await page.content();
    await page.route('**/workspaces/backtest?*', async (route) => {
        if (route.request().headers()['x-requested-with'] === 'workspace-hydrate') {
            await route.fulfill({contentType: 'text/html', body: hydrationHtml});
            return;
        }
        await route.continue();
    });

    let releaseOlderResponse;
    const olderResponseGate = new Promise((resolve) => {
        releaseOlderResponse = resolve;
    });
    const presenceSnapshots = [];
    let olderResponseFulfilled = false;
    await page.route('**/api/market-store/presence?*', async (route) => {
        const tickers = new URL(route.request().url()).searchParams.getAll('ticker');
        presenceSnapshots.push(tickers);
        const isOlderRequest = tickers[0] === 'AAPL';
        if (isOlderRequest) await olderResponseGate;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                tickers,
                missingHistory: [],
                has1m: Object.fromEntries(tickers.map((ticker) => [ticker, !isOlderRequest])),
                periodOptions: Object.fromEntries(tickers.map((ticker) => [ticker, {
                    '1d': ['1d', '1mo', '1y', 'max'],
                    '1m': isOlderRequest
                        ? []
                        : ticker === 'TQQQ'
                            ? ['1d', 'max']
                            : ['1d', '3d', 'max'],
                }])),
            }),
        });
        if (isOlderRequest) olderResponseFulfilled = true;
    });

    const tickerInput = page.locator('#ticker_1');
    await tickerInput.evaluate((input) => {
        input.value = 'AAPL';
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect.poll(() => presenceSnapshots.some((tickers) => tickers.join('|') === 'AAPL|TQQQ')).toBe(true);

    await tickerInput.evaluate((input) => {
        input.value = 'NVDA';
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect.poll(() => presenceSnapshots.some((tickers) => tickers.join('|') === 'NVDA|TQQQ')).toBe(true);
    await expect.poll(() => page.evaluate(() => (
        window.WORTHWARD_APP?.backtestPeriodOptions?.['1m'] || []
    ))).toEqual(['1d', 'max']);
    await expect(page.locator('#backtest_interval_1m')).toBeEnabled();

    releaseOlderResponse();
    await expect.poll(() => olderResponseFulfilled).toBe(true);
    await page.waitForTimeout(100);
    await expect(page.locator('#backtest_interval_1m')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => (
        window.WORTHWARD_APP?.backtestPeriodOptions?.['1m'] || []
    ))).toEqual(['1d', 'max']);
});

