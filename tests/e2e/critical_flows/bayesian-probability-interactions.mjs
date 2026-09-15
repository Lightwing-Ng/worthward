/* Code version: v1.1.1 */
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

export async function exerciseBayesianProbabilityField(page, harness) {
    const {
        contract,
        detailPanel,
        priceCanvas,
        probabilityTooltip,
        summaryTooltip,
        readBaselineGeometry,
        pointAt,
        pointAtIndex,
        waitForChartGeometry,
        pointNearestPriceChartCenter,
        moveToVisiblePriceCurve,
        panSnapshot,
        probabilityScrollPositionTolerance,
        probabilityScrollTargetTolerance,
        waitForPanTarget,
        waitForPanReset,
        movePointerOutsideProbabilitySurface,
        hoverExactIndex,
    } = harness;
    let {baselineGeometry} = harness;

    await movePointerOutsideProbabilitySurface();
    const sectionResizer = page.locator('#backtest_section_resizer');
    await sectionResizer.focus();
    await expect(sectionResizer).toBeFocused();
    await sectionResizer.press('Home');
    await expect.poll(() => page.evaluate(() => {
        const results = document.querySelector('.backtest-results-stack');
        const resizer = document.querySelector('#backtest_section_resizer');
        if (!(results instanceof HTMLElement) || !(resizer instanceof HTMLElement)) return false;
        const stageMinimum = Number.parseFloat(getComputedStyle(results).getPropertyValue(
            '--backtest-probability-stage-min-height',
        ));
        return Number.isFinite(stageMinimum) && stageMinimum > 0
            && Math.abs(
                Number(resizer.getAttribute('aria-valuenow'))
                    - Number(resizer.getAttribute('aria-valuemin')),
            ) <= 1;
    })).toBe(true);

    const minimumAnchor = await pointNearestPriceChartCenter();
    if (!minimumAnchor) throw new Error('Bayesian center probability anchor is unavailable.');
    await hoverExactIndex(minimumAnchor.index);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
            ?._activeBacktestProbabilityGridBounds?.index
    ))).toBe(minimumAnchor.index);
    await waitForPanTarget();

    const minimumGeometry = await page.evaluate(() => {
        const results = document.querySelector('.backtest-results-stack');
        const resizer = document.querySelector('#backtest_section_resizer');
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const grid = tooltip?.querySelector('[data-backtest-probability-grid]');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        if (!(results instanceof HTMLElement) || !(resizer instanceof HTMLElement)
            || !(canvas instanceof HTMLCanvasElement) || !chart?.chartArea
            || !(tooltip instanceof HTMLElement) || !(grid instanceof HTMLElement) || !cells.length) {
            return null;
        }
        const bounds = chart._activeBacktestProbabilityGridBounds;
        const first = cells.find((cell) => cell.dataset.row === '0' && cell.dataset.column === '0');
        const nextColumn = cells.find((cell) => cell.dataset.row === '0' && cell.dataset.column === '1');
        const nextRow = cells.find((cell) => cell.dataset.row === '1' && cell.dataset.column === '0');
        const firstRect = first?.getBoundingClientRect();
        const nextColumnRect = nextColumn?.getBoundingClientRect();
        const nextRowRect = nextRow?.getBoundingClientRect();
        return {
            anchorY: bounds?.anchorY ?? Number.NaN,
            availableRowsAbove: bounds?.availableRowsAbove ?? Number.NaN,
            availableRowsBelow: bounds?.availableRowsBelow ?? Number.NaN,
            availableRowsWithinHalfPlot: bounds?.availableRowsWithinHalfPlot ?? Number.NaN,
            canvasHeight: canvas.getBoundingClientRect().height,
            cellSquareDelta: Math.max(...cells.map((cell) => {
                const rect = cell.getBoundingClientRect();
                return Math.abs(rect.width - rect.height);
            })),
            columns: new Set(cells.map((cell) => cell.dataset.column)).size,
            chartAreaBottom: chart.chartArea.bottom,
            chartAreaTop: chart.chartArea.top,
            cellSize: bounds?.cellSize ?? Number.NaN,
            daysPerColumn: Number(grid.dataset.daysPerColumn),
            horizontalGap: firstRect && nextColumnRect
                ? nextColumnRect.left - firstRect.right
                : Number.NaN,
            resizerMinimum: Number(resizer.getAttribute('aria-valuemin')),
            resizerValue: Number(resizer.getAttribute('aria-valuenow')),
            rowsDown: new Set(cells.filter((cell) => cell.classList.contains('is-down'))
                .map((cell) => cell.dataset.row)).size,
            rowsUp: new Set(cells.filter((cell) => cell.classList.contains('is-up'))
                .map((cell) => cell.dataset.row)).size,
            slotLatticeDelta: bounds
                ? Math.abs(
                    ((bounds.cellSize + bounds.gap) / bounds.stepPixels) - bounds.daysPerColumn,
                )
                : Number.POSITIVE_INFINITY,
            stageMinimum: Number.parseFloat(getComputedStyle(results).getPropertyValue(
                '--backtest-probability-stage-min-height',
            )),
            stackHeight: canvas.closest('.trade-chart-stack')?.getBoundingClientRect().height
                ?? Number.NaN,
            verticalGap: firstRect && nextRowRect
                ? nextRowRect.top - firstRect.bottom
                : Number.NaN,
        };
    });
    expect(minimumGeometry).not.toBeNull();
    expect(Math.abs(
        minimumGeometry.resizerValue - minimumGeometry.resizerMinimum,
    )).toBeLessThanOrEqual(1);
    expect(minimumGeometry.stageMinimum).toBeGreaterThan(0);
    expect(minimumGeometry.availableRowsAbove).toBeGreaterThanOrEqual(12);
    expect(minimumGeometry.availableRowsBelow).toBeGreaterThanOrEqual(12);
    expect(minimumGeometry.availableRowsWithinHalfPlot).toBeGreaterThanOrEqual(12);
    expect(minimumGeometry.rowsUp, JSON.stringify(minimumGeometry)).toBe(12);
    expect(minimumGeometry.rowsDown).toBe(12);
    expect(minimumGeometry.columns).toBe(20);
    expect(minimumGeometry.cellSquareDelta).toBeLessThanOrEqual(0.1);
    expect(minimumGeometry.horizontalGap).toBeCloseTo(2, 1);
    expect(minimumGeometry.verticalGap).toBeCloseTo(2, 1);
    expect(Number.isInteger(minimumGeometry.daysPerColumn)).toBe(true);
    expect(minimumGeometry.daysPerColumn).toBeGreaterThanOrEqual(1);
    expect(minimumGeometry.slotLatticeDelta).toBeLessThanOrEqual(1e-9);

    const currentMinimumAnchor = await pointAtIndex(minimumAnchor.index);
    if (!currentMinimumAnchor) throw new Error('Bayesian center probability click anchor is unavailable after resizing.');
    await page.mouse.click(currentMinimumAnchor.x, currentMinimumAnchor.y);
    await expect(probabilityTooltip).toHaveAttribute('data-pinned', 'true');
    // The horizontal probability rail shares the section-resizer slot. Reset
    // the pinned field before exercising the vertical rail so both controls
    // retain an independent interaction contract.
    await page.keyboard.press('Escape');
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await expect.poll(() => page.evaluate(() => (
        document.querySelector('[data-backtest-probability-scrollport]')?.hidden === true
    ))).toBe(true);
    const dragAnchor = await moveToVisiblePriceCurve(0.05, 'Bayesian left-side drag');
    if (!dragAnchor) throw new Error('Bayesian left-side drag anchor is unavailable.');
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    await waitForPanTarget();
    // Tracking keeps the vertical guide on the pointer. Clicking that same
    // screen coordinate still pins the selected origin after any overflow pan.
    await page.mouse.click(dragAnchor.x, dragAnchor.y);
    await expect(probabilityTooltip).toHaveAttribute('data-pinned', 'true');
    await expect.poll(() => page.evaluate(() => (
        document.querySelector('[data-backtest-probability-scrollport]')?.hidden === true
    ))).toBe(true);
    const readPinnedGridSnapshot = () => page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        const bounds = chart?._activeBacktestProbabilityGridBounds;
        const point = chart?.getDatasetMeta?.(0)?.data?.[bounds?.index];
        const canvasRect = canvas?.getBoundingClientRect();
        const scaleY = canvasRect && chart?.height ? canvasRect.height / chart.height : 0;
        if (!(canvas instanceof HTMLCanvasElement) || !chart?.chartArea
            || !(tooltip instanceof HTMLElement) || !cells.length
            || !bounds || !point || !(scaleY > 0) || !chart.scales?.y) return null;
        const cellGeometryDelta = Math.max(...cells.map((cell) => {
            const rect = cell.getBoundingClientRect();
            const row = Number(cell.dataset.row);
            const expectedTop = bounds.top + bounds.gridPaddingTop
                + (row * (bounds.cellSize + bounds.gap));
            const expectedBottom = expectedTop + bounds.cellSize;
            return Math.max(
                Math.abs(((rect.top - canvasRect.top) / scaleY) - expectedTop),
                Math.abs(((rect.bottom - canvasRect.top) / scaleY) - expectedBottom),
            );
        }));
        const priceMappingDelta = Math.max(...cells.map((cell) => {
            const rect = cell.getBoundingClientRect();
            const lower = Math.min(
                chart.scales.y.getValueForPixel((rect.top - canvasRect.top) / scaleY),
                chart.scales.y.getValueForPixel((rect.bottom - canvasRect.top) / scaleY),
            );
            const upper = Math.max(
                chart.scales.y.getValueForPixel((rect.top - canvasRect.top) / scaleY),
                chart.scales.y.getValueForPixel((rect.bottom - canvasRect.top) / scaleY),
            );
            return Math.max(
                Math.abs(lower - Number(cell.dataset.lowerPrice)),
                Math.abs(upper - Number(cell.dataset.upperPrice)),
            );
        }));
        return {
            canvasHeight: canvasRect.height,
            chartAreaHeight: chart.chartArea.bottom - chart.chartArea.top,
            cellGeometryDelta,
            guideDelta: Math.abs(bounds.intersectionY - point.y),
            priceMappingDelta,
            resizerValue: Number(document.querySelector('#backtest_section_resizer')?.getAttribute('aria-valuenow')),
            rowsDown: bounds.rowsBelow,
            rowsUp: bounds.rowsAbove,
            verticalGap: cells[0] && cells[20]
                ? cells[20].getBoundingClientRect().top - cells[0].getBoundingClientRect().bottom
                : Number.NaN,
        };
    });
    const beforeDrag = await readPinnedGridSnapshot();
    expect(beforeDrag).not.toBeNull();
    const resizerRoom = await page.evaluate(() => {
        const resizer = document.querySelector('#backtest_section_resizer');
        if (!(resizer instanceof HTMLElement)) return 0;
        return Number(resizer.getAttribute('aria-valuemax'))
            - Number(resizer.getAttribute('aria-valuenow'));
    });
    if (resizerRoom > 8) {
        const handleBox = await sectionResizer.boundingBox();
        if (!handleBox) throw new Error('Backtest vertical resizer is unavailable.');
        await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
        await page.mouse.down();
        await page.mouse.move(
            handleBox.x + (handleBox.width / 2),
            handleBox.y + (handleBox.height / 2) + 48,
            {steps: 4},
        );
        await page.mouse.up();
        await expect.poll(() => page.evaluate((previousValue) => {
            const resizer = document.querySelector('#backtest_section_resizer');
            return resizer instanceof HTMLElement
                && Number(resizer.getAttribute('aria-valuenow')) > previousValue;
        }, beforeDrag.resizerValue)).toBe(true);
        await expect.poll(async () => {
            const snapshot = await readPinnedGridSnapshot();
            return snapshot && snapshot.canvasHeight > beforeDrag.canvasHeight + 1
                && snapshot.guideDelta <= 0.1
                && snapshot.cellGeometryDelta <= 1
                && snapshot.priceMappingDelta <= 0.1;
        }).toBe(true);
        const afterDrag = await readPinnedGridSnapshot();
        expect(afterDrag).not.toBeNull();
        expect(afterDrag.canvasHeight).toBeGreaterThan(beforeDrag.canvasHeight + 1);
        expect(afterDrag.chartAreaHeight).toBeGreaterThan(beforeDrag.chartAreaHeight + 1);
        expect(afterDrag.rowsUp).toBeLessThanOrEqual(12);
        expect(afterDrag.rowsDown).toBeLessThanOrEqual(12);
        expect(afterDrag.verticalGap).toBeCloseTo(2, 1);
        expect(afterDrag.guideDelta).toBeLessThanOrEqual(0.1);
        expect(afterDrag.cellGeometryDelta).toBeLessThanOrEqual(1);
        expect(afterDrag.priceMappingDelta).toBeLessThanOrEqual(0.1);
    }

    await page.keyboard.press('Escape');
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await page.mouse.move(10, 10);
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    const retainedDetail = await page.evaluate(() => {
        const panel = document.querySelector('#backtest_probability_detail_panel');
        const grid = panel?.querySelector('[data-backtest-probability-detail-grid]');
        return {
            activeIndex: Number(panel?.dataset.activeIndex),
            cellCount: grid?.querySelectorAll('.backtest-probability-detail-cell').length || 0,
            hidden: panel instanceof HTMLElement ? panel.hidden : true,
        };
    });
    expect(retainedDetail.hidden).toBe(false);
    expect(retainedDetail.activeIndex).toBe(dragAnchor.index);
    expect(retainedDetail.cellCount).toBeGreaterThan(0);
    await waitForPanReset();
    await sectionResizer.focus();
    await sectionResizer.press('End');
    await expect.poll(() => page.evaluate(() => {
        const resizer = document.querySelector('#backtest_section_resizer');
        return resizer instanceof HTMLElement
            && Number(resizer.getAttribute('aria-valuenow'))
                === Number(resizer.getAttribute('aria-valuemax'));
    })).toBe(true);
    baselineGeometry = await readBaselineGeometry();
    expect(baselineGeometry).not.toBeNull();

    // Leave real curve content to pan; the final endpoint has zero automatic pan capacity.
    const rightAnchor = await pointAt(0.85);
    if (!rightAnchor) throw new Error('Bayesian right-side hover anchor is unavailable.');
    await page.mouse.move(rightAnchor.x, rightAnchor.y);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    await waitForPanTarget();

    const rightPan = await page.evaluate(({expectedTooltipWidth, pointerX, pointerY}) => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const priceCanvasElement = document.querySelector('#tradePriceChart');
        const equityCanvasElement = document.querySelector('#tradeEquityChart');
        const chart = window.Chart?.getChart?.(priceCanvasElement);
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        const resizer = document.querySelector('#backtest_section_resizer');
        const hoverLine = document.querySelector('.trade-chart-hover-line');
        const horizontalHoverLine = document.querySelector('.trade-chart-hover-horizontal-line');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        const firstProbabilityCell = cells.find((cell) => (
            cell.dataset.row === '0' && cell.dataset.column === '0'
        ));
        if (!(stack instanceof HTMLElement)
            || !(priceCanvasElement instanceof HTMLCanvasElement)
            || !(equityCanvasElement instanceof HTMLCanvasElement)
            || !(tooltip instanceof HTMLElement)
            || !(scrollPort instanceof HTMLElement)
            || !(resizer instanceof HTMLElement)
            || !(hoverLine instanceof HTMLElement)
            || !(horizontalHoverLine instanceof HTMLElement)
            || !(firstProbabilityCell instanceof HTMLElement)
            || !chart) {
            return null;
        }
        const stackRect = stack.getBoundingClientRect();
        const priceRect = priceCanvasElement.getBoundingClientRect();
        const equityRect = equityCanvasElement.getBoundingClientRect();
        const resizerRect = resizer.getBoundingClientRect();
        const resizerSlotRect = document.querySelector('[data-backtest-section-resizer-slot]')?.getBoundingClientRect();
        const historyRect = document.querySelector('#backtest_history_surface')?.getBoundingClientRect();
        const scrollPortRect = scrollPort.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const hoverLineRect = hoverLine.getBoundingClientRect();
        const horizontalHoverLineRect = horizontalHoverLine.getBoundingClientRect();
        const firstProbabilityCellRect = firstProbabilityCell.getBoundingClientRect();
        const bounds = chart._activeBacktestProbabilityGridBounds;
        const scrollbarStyle = getComputedStyle(scrollPort);
        const scrollbarPseudoStyle = getComputedStyle(scrollPort, '::-webkit-scrollbar');
        const scrollbarThumbStyle = getComputedStyle(scrollPort, '::-webkit-scrollbar-thumb');
        const visualPosition = Number(stack.dataset.probabilityPanVisualPosition || 0);
        const visualOffset = Number(stack.dataset.probabilityPanVisualOffset || 0);
        const lastCurvePoint = [...(chart.getDatasetMeta(0)?.data || [])]
            .reverse()
            .find((candidate) => Number.isFinite(candidate?.x));
        const curveRightContentLeft = lastCurvePoint && Number(chart.width) > 0
            ? priceRect.left - stackRect.left + visualPosition
                + (lastCurvePoint.x * (priceRect.width / chart.width))
            : Number.NaN;
        const lastVisualX = lastCurvePoint && Number(chart.width) > 0
            ? priceRect.left + (lastCurvePoint.x * (priceRect.width / chart.width))
            : Number.NaN;
        const screenPointerX = Math.trunc(pointerX) - stackRect.left;
        const expectedTarget = Math.min(
            Math.max(0, screenPointerX + tooltipRect.width - stackRect.width),
            Math.max(0, curveRightContentLeft - screenPointerX),
        );
        return {
            activeIndex: bounds?.index,
            expectedActiveIndex: chart.getDatasetMeta(0).data.reduce((best, point, index, points) => (
                Math.abs(priceRect.left + point.x * priceRect.width / chart.width - pointerX)
                < Math.abs(priceRect.left + points[best].x * priceRect.width / chart.width - pointerX)
                    ? index : best
            ), 0),
            canvasTooltipAnchorDelta: Number.isFinite(curveRightContentLeft)
                ? Math.abs(
                    tooltipRect.left
                    - (hoverLineRect.left + (hoverLineRect.width / 2)),
                )
                : Number.POSITIVE_INFINITY,
            linePastLast: Number.isFinite(lastVisualX)
                ? (hoverLineRect.left + (hoverLineRect.width / 2)) - lastVisualX
                : Number.NaN,
            fieldRightOfVerticalLine: firstProbabilityCellRect.left - hoverLineRect.right,
            domOrderStable: stack.children[0]?.contains(priceCanvasElement)
                && stack.children[1]?.contains(equityCanvasElement),
            equityHeight: equityRect.height,
            equityLeft: equityRect.left,
            equityTop: equityRect.top,
            historyTop: historyRect?.top ?? Number.NaN,
            leftInset: tooltipRect.left - stackRect.left,
            motion: stack.dataset.probabilityPanMotion,
            maximumOpacity: cells.length
                ? Math.max(...cells.map((cell) => Number(getComputedStyle(cell).opacity)))
                : null,
            minimumOpacity: cells.length
                ? Math.min(...cells.map((cell) => Number(getComputedStyle(cell).opacity)))
                : null,
            invisibleCellCount: cells.filter((cell) => (
                Number(getComputedStyle(cell).opacity) === 0
            )).length,
            pointerToHorizontalLine: Math.abs(
                (horizontalHoverLineRect.top + (horizontalHoverLineRect.height / 2)) - pointerY,
            ),
            curveToHorizontalLine: (() => {
                const scaleY = chart.height > 0 ? priceRect.height / chart.height : Number.NaN;
                const curveY = Number.isFinite(bounds?.intersectionY) && Number.isFinite(scaleY)
                    ? priceRect.top + (bounds.intersectionY * scaleY)
                    : Number.NaN;
                return Number.isFinite(curveY)
                    ? Math.abs(
                        (horizontalHoverLineRect.top + (horizontalHoverLineRect.height / 2)) - curveY,
                    )
                    : Number.NaN;
            })(),
            pointerToVerticalLine: Math.abs(
                (hoverLineRect.left + (hoverLineRect.width / 2)) - pointerX,
            ),
            horizontalGuidePastVertical: horizontalHoverLineRect.right
                - (hoverLineRect.left + (hoverLineRect.width / 2)),
            horizontalGuidePastField: horizontalHoverLineRect.right - tooltipRect.right,
            pointerToField: Math.abs(tooltipRect.left - pointerX),
            overflowX: getComputedStyle(stack).overflowX,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            portActive: !scrollPort.hidden,
            portAriaHidden: scrollPort.getAttribute('aria-hidden'),
            portBottom: scrollPortRect.bottom,
            portClientWidth: scrollPort.clientWidth,
            portHeight: scrollPortRect.height,
            portLeft: scrollPortRect.left,
            portPointerEvents: scrollbarStyle.pointerEvents,
            portScrollDistance: scrollPort.scrollWidth - scrollPort.clientWidth,
            portScrollLeft: scrollPort.scrollLeft,
            portScrollWidth: scrollPort.scrollWidth,
            portTop: scrollPortRect.top,
            priceHeight: priceRect.height,
            priceLeft: priceRect.left,
            priceTop: priceRect.top,
            priceWidth: priceRect.width,
            resizerAriaHidden: resizer.getAttribute('aria-hidden'),
            resizerFocused: document.activeElement === resizer,
            resizerHeight: resizerRect.height,
            resizerPointerEvents: getComputedStyle(resizer).pointerEvents,
            resizerSlotHeight: resizerSlotRect?.height ?? Number.NaN,
            resizerSlotTop: resizerSlotRect?.top ?? Number.NaN,
            resizerTabIndex: resizer.getAttribute('tabindex'),
            resizerTop: resizerRect.top,
            rightInset: stackRect.right - tooltipRect.right,
            scrollLeft: stack.scrollLeft,
            scrollWidth: stack.scrollWidth,
            scrollbarColor: scrollbarStyle.scrollbarColor,
            scrollbarGutter: scrollbarStyle.scrollbarGutter,
            scrollbarThumbBackground: scrollbarThumbStyle.backgroundColor,
            scrollbarWidth: scrollbarStyle.scrollbarWidth,
            webkitScrollbarHeight: scrollbarPseudoStyle.height,
            webkitScrollbarWidth: scrollbarPseudoStyle.width,
            stackClientWidth: stack.clientWidth,
            stackClientHeight: stack.clientHeight,
            stackHeight: stackRect.height,
            stackLeft: stackRect.left,
            target: Number(stack.dataset.probabilityPanTarget),
            targetFormulaDelta: Math.abs(Number(stack.dataset.probabilityPanTarget) - expectedTarget),
            tooltipWidthDelta: Math.abs(tooltipRect.width - expectedTooltipWidth),
            visualOffset,
            visualPosition,
        };
    }, {expectedTooltipWidth: contract.tooltipWidth, pointerX: rightAnchor.x, pointerY: rightAnchor.y});
    expect(rightPan).not.toBeNull();
    expect(rightPan.activeIndex).toBe(rightPan.expectedActiveIndex);
    expect(rightPan.target).toBeGreaterThan(0);
    expect(rightPan.maximumOpacity).toBe(1);
    expect(rightPan.minimumOpacity).toBeGreaterThan(0);
    expect(rightPan.invisibleCellCount).toBe(0);
    expect(Math.abs(rightPan.scrollLeft - rightPan.target))
        .toBeLessThanOrEqual(probabilityScrollPositionTolerance);
    expect(Math.abs(rightPan.portScrollLeft - rightPan.target))
        .toBeLessThanOrEqual(probabilityScrollPositionTolerance);
    expect(Math.abs(rightPan.visualPosition - rightPan.target))
        .toBeLessThanOrEqual(probabilityScrollTargetTolerance);
    expect(Math.abs((rightPan.scrollLeft - rightPan.visualPosition) - rightPan.visualOffset))
        .toBeLessThanOrEqual(probabilityScrollTargetTolerance);
    expect(rightPan.targetFormulaDelta).toBeLessThanOrEqual(probabilityScrollTargetTolerance);
    expect(rightPan.overflowX).toBe('hidden');
    expect(rightPan.portActive).toBe(true);
    expect(rightPan.portAriaHidden).toBe('false');
    expect(rightPan.portPointerEvents).toBe('auto');
    expect(rightPan.portClientWidth).toBeGreaterThan(0);
    expect(rightPan.portScrollWidth).toBeGreaterThan(rightPan.portClientWidth);
    expect(Math.abs(rightPan.portScrollDistance - rightPan.target)).toBeLessThanOrEqual(1);
    expect(rightPan.scrollbarGutter).toBe('auto');
    expect(rightPan.scrollbarColor).toBe('auto');
    expect(rightPan.scrollbarWidth).toBe('auto');
    expect(rightPan.webkitScrollbarHeight).toBe('auto');
    expect(rightPan.webkitScrollbarWidth).toBe('auto');
    expect(rightPan.scrollbarThumbBackground).not.toBe('rgb(0, 85, 204)');
    expect(rightPan.scrollWidth).toBeGreaterThan(rightPan.stackClientWidth);
    expect(rightPan.portTop).toBeLessThanOrEqual(rightPan.resizerTop + 0.1);
    expect(rightPan.portBottom).toBeGreaterThanOrEqual(rightPan.resizerTop + rightPan.resizerHeight - 0.1);
    expect(rightPan.portHeight).toBeGreaterThanOrEqual(rightPan.resizerHeight);
    expect(rightPan.resizerAriaHidden).toBeNull();
    expect(rightPan.resizerPointerEvents).toBe('auto');
    expect(rightPan.resizerTabIndex).toBeNull();
    expect(rightPan.leftInset).toBeGreaterThanOrEqual(0);
    expect(rightPan.tooltipWidthDelta).toBeLessThanOrEqual(0.1);
    expect(rightPan.linePastLast).toBeLessThanOrEqual(1.5);
    expect(rightPan.curveToHorizontalLine).toBeLessThanOrEqual(1.5);
    expect(rightPan.horizontalGuidePastVertical).toBeGreaterThanOrEqual(8);
    expect(rightPan.horizontalGuidePastField).toBeGreaterThanOrEqual(-0.5);
    expect(rightPan.fieldRightOfVerticalLine).toBeGreaterThanOrEqual(0.5);
    expect(rightPan.canvasTooltipAnchorDelta).toBeLessThanOrEqual(0.75);
    expect(rightPan.motion).toBe('shared-pointer-follow');
    expect(Math.abs(rightPan.stackLeft - baselineGeometry.stackLeft)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.priceWidth - baselineGeometry.priceWidth)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.priceHeight - baselineGeometry.priceHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.priceTop - baselineGeometry.priceTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.equityHeight - baselineGeometry.equityHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.equityTop - baselineGeometry.equityTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.stackClientHeight - baselineGeometry.stackClientHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.stackHeight - baselineGeometry.stackHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.resizerHeight - baselineGeometry.resizerHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.resizerTop - baselineGeometry.resizerTop)).toBeLessThanOrEqual(1.1);
    expect(Math.abs(rightPan.resizerSlotHeight - baselineGeometry.resizerSlotHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.resizerSlotTop - baselineGeometry.resizerSlotTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.historyTop - baselineGeometry.historyTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs((baselineGeometry.priceLeft - rightPan.priceLeft) - rightPan.visualPosition))
        .toBeLessThanOrEqual(0.1);
    expect(Math.abs((baselineGeometry.equityLeft - rightPan.equityLeft) - rightPan.visualPosition))
        .toBeLessThanOrEqual(0.1);
    expect(Math.abs(rightPan.priceLeft - rightPan.equityLeft)).toBeLessThanOrEqual(0.1);
    expect(rightPan.pageOverflow).toBeLessThanOrEqual(0);
    expect(rightPan.domOrderStable).toBe(true);

    const activeResizerBefore = await page.evaluate(() => ({
        history: document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0,
        overview: document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0,
        resizer: document.querySelector('#backtest_section_resizer') instanceof HTMLElement
            ? document.querySelector('#backtest_section_resizer').getBoundingClientRect()
            : null,
        scrollPortHidden: document.querySelector('[data-backtest-probability-scrollport]')?.hidden,
    }));
    expect(activeResizerBefore.scrollPortHidden).toBe(false);
    expect(activeResizerBefore.resizer).not.toBeNull();
    const activeResizerBox = await sectionResizer.boundingBox();
    if (!activeResizerBox) throw new Error('Active Bayesian vertical resizer is unavailable.');
    await page.mouse.move(
        activeResizerBox.x + (activeResizerBox.width / 2),
        activeResizerBox.y + (activeResizerBox.height / 2),
    );
    await expect.poll(() => page.evaluate(() => ({
        hitResizer: Boolean(document.elementFromPoint(
            Number(document.querySelector('#backtest_section_resizer')?.getBoundingClientRect().left || 0) + 8,
            Number(document.querySelector('#backtest_section_resizer')?.getBoundingClientRect().top || 0) + 5,
        )?.closest('#backtest_section_resizer')),
        scrollPortHidden: document.querySelector('[data-backtest-probability-scrollport]')?.hidden,
    }))).toEqual({hitResizer: true, scrollPortHidden: false});
    await page.mouse.down();
    await page.mouse.move(
        activeResizerBox.x + (activeResizerBox.width / 2),
        activeResizerBox.y + (activeResizerBox.height / 2) - 48,
        {steps: 4},
    );
    await page.mouse.up();
    await expect.poll(() => page.evaluate((beforeSize) => {
        const overview = document.querySelector('.backtest-trade-performance-card')?.getBoundingClientRect().height || 0;
        const history = document.querySelector('#backtest_history_surface')?.getBoundingClientRect().height || 0;
        return overview < beforeSize.overview && history > beforeSize.history;
    }, activeResizerBefore)).toBe(true);
    await expect.poll(() => page.evaluate(() => ({
        ariaHidden: document.querySelector('#backtest_section_resizer')?.getAttribute('aria-hidden'),
        pointerEvents: document.querySelector('#backtest_section_resizer') instanceof HTMLElement
            ? getComputedStyle(document.querySelector('#backtest_section_resizer')).pointerEvents
            : null,
        tabIndex: document.querySelector('#backtest_section_resizer')?.getAttribute('tabindex'),
    }))).toEqual({ariaHidden: null, pointerEvents: 'auto', tabIndex: null});
    // Return to the max endpoint used by the surrounding geometry assertions.
    await sectionResizer.focus();
    await sectionResizer.press('End');
    await expect.poll(() => page.evaluate(() => {
        const resizer = document.querySelector('#backtest_section_resizer');
        return resizer instanceof HTMLElement
            && Number(resizer.getAttribute('aria-valuenow'))
                === Number(resizer.getAttribute('aria-valuemax'));
    })).toBe(true);
    await waitForChartGeometry();
    await expect(probabilityTooltip).toHaveClass(/is-visible/);

    const manualRailSync = await page.evaluate(() => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        if (!(stack instanceof HTMLElement) || !(scrollPort instanceof HTMLElement)) return null;
        const previous = scrollPort.scrollLeft;
        const next = Math.max(0, previous - Math.min(24, Math.max(1, previous / 2)));
        scrollPort.scrollLeft = next;
        scrollPort.dispatchEvent(new Event('scroll'));
        return {
            next,
            previous,
            portScrollLeft: scrollPort.scrollLeft,
            stackScrollLeft: stack.scrollLeft,
            visualOffset: Number(stack.dataset.probabilityPanVisualOffset || 0),
            visualPosition: Number(stack.dataset.probabilityPanVisualPosition || 0),
        };
    });
    expect(manualRailSync).not.toBeNull();
    expect(manualRailSync.previous).toBeGreaterThan(0);
    expect(manualRailSync.next).toBeLessThan(manualRailSync.previous);
    expect(Math.abs(manualRailSync.portScrollLeft - manualRailSync.stackScrollLeft))
        .toBeLessThanOrEqual(probabilityScrollPositionTolerance);
    expect(Math.abs(manualRailSync.visualPosition - manualRailSync.stackScrollLeft))
        .toBeLessThanOrEqual(probabilityScrollTargetTolerance);
    expect(Math.abs(manualRailSync.visualOffset)).toBeLessThanOrEqual(probabilityScrollTargetTolerance);

    const maxRailSync = await page.evaluate(() => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        const canvas = document.querySelector('#tradePriceChart');
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const hoverLine = document.querySelector('.trade-chart-hover-line');
        const chart = window.Chart?.getChart?.(canvas);
        if (!(stack instanceof HTMLElement)
            || !(scrollPort instanceof HTMLElement)
            || !(canvas instanceof HTMLCanvasElement)
            || !(tooltip instanceof HTMLElement)
            || !(hoverLine instanceof HTMLElement)
            || !chart) return null;
        scrollPort.scrollLeft = scrollPort.scrollWidth;
        scrollPort.dispatchEvent(new Event('scroll'));
        const stackRect = stack.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const hoverLineRect = hoverLine.getBoundingClientRect();
        const bounds = chart._activeBacktestProbabilityGridBounds;
        const point = chart.getDatasetMeta(0)?.data?.[bounds?.index];
        const curveX = point && chart.width > 0
            ? canvasRect.left + (point.x * (canvasRect.width / chart.width))
            : Number.NaN;
        return {
            curveX,
            hoverLineAnchorDelta: Math.abs(
                (hoverLineRect.left + (hoverLineRect.width / 2)) - curveX,
            ),
            leftInset: tooltipRect.left - stackRect.left,
            portMaximum: scrollPort.scrollWidth - scrollPort.clientWidth,
            portScrollLeft: scrollPort.scrollLeft,
            rightInset: stackRect.right - tooltipRect.right,
            stackScrollLeft: stack.scrollLeft,
            target: Number(stack.dataset.probabilityPanTarget || 0),
            tooltipAnchorDelta: Math.abs(tooltipRect.left - curveX),
            visualOffset: Number(stack.dataset.probabilityPanVisualOffset || 0),
            visualPosition: Number(stack.dataset.probabilityPanVisualPosition || 0),
        };
    });
    expect(maxRailSync).not.toBeNull();
    expect(maxRailSync.portScrollLeft).toBe(maxRailSync.portMaximum);
    expect(maxRailSync.stackScrollLeft).toBe(maxRailSync.portMaximum);
    expect(Math.abs(maxRailSync.visualPosition - maxRailSync.target))
        .toBeLessThanOrEqual(probabilityScrollTargetTolerance);
    // Exact-integer targets legitimately produce no fractional correction;
    // fractional native rail positions must still remain below one pixel.
    expect(maxRailSync.visualOffset).toBeGreaterThanOrEqual(0);
    expect(maxRailSync.visualOffset).toBeLessThan(1);
    expect(Math.abs(
        (maxRailSync.stackScrollLeft - maxRailSync.visualPosition) - maxRailSync.visualOffset,
    )).toBeLessThanOrEqual(probabilityScrollTargetTolerance);
    expect(maxRailSync.leftInset).toBeGreaterThanOrEqual(0);
    expect(maxRailSync.tooltipAnchorDelta).toBeLessThanOrEqual(0.1);
    expect(maxRailSync.hoverLineAnchorDelta).toBeLessThanOrEqual(0.1);

    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    const interruptedReturnPromise = page.evaluate(() => new Promise((resolve, reject) => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        if (!(stack instanceof HTMLElement) || !(scrollPort instanceof HTMLElement)) {
            reject(new Error('The native probability scroll port is unavailable.'));
            return;
        }
        const timeoutId = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error('The probability field did not enter its active return state.'));
        }, 1_000);
        const observer = new MutationObserver(() => {
            const target = Number(stack.dataset.probabilityPanTarget || 0);
            const previous = scrollPort.scrollLeft;
            if (target > 0.01 || scrollPort.hidden || stack.scrollLeft <= 0 || previous <= 1) return;
            const next = Math.max(1, Math.floor(previous / 2));
            if (next >= previous) {
                observer.disconnect();
                window.clearTimeout(timeoutId);
                reject(new Error('The active return state has no smaller native rail position.'));
                return;
            }
            observer.disconnect();
            window.clearTimeout(timeoutId);
            // This changes the browser-native scroll position. It deliberately
            // does not construct or dispatch a synthetic scroll event.
            scrollPort.scrollLeft = next;
            resolve({next, previous, target});
        });
        observer.observe(stack, {
            attributes: true,
            attributeFilter: ['data-probability-pan-target'],
        });
    }));
    await page.mouse.move(8, 800);
    const interruptedReturn = await interruptedReturnPromise;
    expect(interruptedReturn).not.toBeNull();
    expect(interruptedReturn.target).toBeLessThanOrEqual(0.01);
    expect(interruptedReturn.next).toBeLessThan(interruptedReturn.previous);
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await waitForPanReset();
    const resetGeometry = await page.evaluate(() => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const price = document.querySelector('#tradePriceChart')?.getBoundingClientRect();
        const equity = document.querySelector('#tradeEquityChart')?.getBoundingClientRect();
        const resizer = document.querySelector('#backtest_section_resizer');
        const resizerRect = resizer?.getBoundingClientRect();
        const resizerSlot = document.querySelector('[data-backtest-section-resizer-slot]')?.getBoundingClientRect();
        const history = document.querySelector('#backtest_history_surface')?.getBoundingClientRect();
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        const stackRect = stack?.getBoundingClientRect();
        return price && equity && resizer instanceof HTMLElement && resizerRect && resizerSlot && history
            && scrollPort instanceof HTMLElement && stack instanceof HTMLElement && stackRect ? {
                equityHeight: equity.height,
                equityTop: equity.top,
                historyTop: history.top,
                portAriaHidden: scrollPort.getAttribute('aria-hidden'),
                portHidden: scrollPort.hidden,
                priceHeight: price.height,
                priceTop: price.top,
                resizerAriaHidden: resizer.getAttribute('aria-hidden'),
                resizerHeight: resizerRect.height,
                resizerPointerEvents: getComputedStyle(resizer).pointerEvents,
                resizerSlotHeight: resizerSlot.height,
                resizerSlotTop: resizerSlot.top,
                resizerTabIndex: resizer.getAttribute('tabindex'),
                resizerTop: resizerRect.top,
                stackClientHeight: stack.clientHeight,
                stackHeight: stackRect.height,
            } : null;
    });
    expect(resetGeometry).not.toBeNull();
    expect(resetGeometry.portHidden).toBe(true);
    expect(resetGeometry.portAriaHidden).toBe('true');
    expect(resetGeometry.resizerAriaHidden).toBeNull();
    expect(resetGeometry.resizerPointerEvents).toBe('auto');
    expect(resetGeometry.resizerTabIndex).toBeNull();
    await sectionResizer.focus();
    await expect(sectionResizer).toBeFocused();
    expect(Math.abs(resetGeometry.priceHeight - baselineGeometry.priceHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.priceTop - baselineGeometry.priceTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.equityHeight - baselineGeometry.equityHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.equityTop - baselineGeometry.equityTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.stackClientHeight - baselineGeometry.stackClientHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.stackHeight - baselineGeometry.stackHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.resizerHeight - baselineGeometry.resizerHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.resizerTop - baselineGeometry.resizerTop)).toBeLessThanOrEqual(1.1);
    expect(Math.abs(resetGeometry.resizerSlotHeight - baselineGeometry.resizerSlotHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.resizerSlotTop - baselineGeometry.resizerSlotTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(resetGeometry.historyTop - baselineGeometry.historyTop)).toBeLessThanOrEqual(0.1);
    const secondRightAnchor = await pointAt(1);
    if (!secondRightAnchor) throw new Error('Bayesian second right-side hover anchor is unavailable.');
    await page.mouse.move(secondRightAnchor.x, secondRightAnchor.y);
    await waitForPanTarget();
    const equityRailReset = await page.evaluate(() => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        if (!(stack instanceof HTMLElement) || !(scrollPort instanceof HTMLElement)) return null;
        scrollPort.scrollLeft = 0;
        scrollPort.dispatchEvent(new Event('scroll'));
        return {portScrollLeft: scrollPort.scrollLeft, stackScrollLeft: stack.scrollLeft};
    });
    expect(equityRailReset).toEqual({portScrollLeft: 0, stackScrollLeft: 0});
    const equityAnchor = await pointAt(0.96, '#tradeEquityChart');
    if (!equityAnchor) throw new Error('Backtest equity hover anchor is unavailable.');
    await page.mouse.move(equityAnchor.x, equityAnchor.y);
    await expect(summaryTooltip).toHaveClass(/is-visible/);
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await waitForPanReset();

    const pinAnchor = await moveToVisiblePriceCurve(0.20, 'Bayesian pin hover');
    if (!pinAnchor) throw new Error('Bayesian pin anchor is unavailable.');
    await waitForPanTarget();
    await page.mouse.click(pinAnchor.x, pinAnchor.y, {button: 'left'});
    await expect(probabilityTooltip).toHaveAttribute('data-pinned', 'true');
    await waitForPanTarget();
    const pinned = await panSnapshot();
    const pinnedIndex = await page.evaluate(() => (
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
            ?._activeBacktestProbabilityGridBounds?.index
    ));
    expect(pinnedIndex).toBe(pinAnchor.index);

    const ignoredHover = await pointAt(0.62);
    if (!ignoredHover) throw new Error('Bayesian pinned hover probe is unavailable.');
    await page.mouse.move(ignoredHover.x, ignoredHover.y);
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
            ?._activeBacktestProbabilityGridBounds?.index
    ))).toBe(pinnedIndex);
    const pinnedAfterHover = await panSnapshot();
    expect(pinnedAfterHover.target).toBe(pinned.target);
    expect(Math.abs(pinnedAfterHover.scrollLeft - pinned.scrollLeft)).toBeLessThanOrEqual(0.75);

    const blank = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        if (!chart?.chartArea || !rect) return null;
        const index = Math.round((chart.getDatasetMeta(0).data.length - 1) * 0.62);
        const point = chart.getDatasetMeta(0).data[index];
        const top = chart.chartArea.top + 2;
        const bottom = chart.chartArea.bottom - 2;
        const y = Math.abs(top - point.y) > Math.abs(bottom - point.y) ? top : bottom;
        return {x: rect.left + point.x, y: rect.top + y};
    });
    if (!blank) throw new Error('Bayesian blank-space target is unavailable.');
    await page.mouse.click(blank.x, blank.y);
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await waitForPanReset();
    const blankResetGeometry = await page.evaluate(() => {
        const price = document.querySelector('#tradePriceChart')?.getBoundingClientRect();
        const equity = document.querySelector('#tradeEquityChart')?.getBoundingClientRect();
        return price && equity ? {equityLeft: equity.left, priceLeft: price.left} : null;
    });
    expect(blankResetGeometry).not.toBeNull();
    expect(Math.abs(blankResetGeometry.priceLeft - baselineGeometry.priceLeft))
        .toBeLessThanOrEqual(0.1);
    expect(Math.abs(blankResetGeometry.equityLeft - baselineGeometry.equityLeft))
        .toBeLessThanOrEqual(0.1);

    const resumedPinAnchor = await moveToVisiblePriceCurve(0.20, 'Bayesian resumed hover');
    if (!resumedPinAnchor) throw new Error('Bayesian resumed pin anchor is unavailable.');
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    await expect(probabilityTooltip).not.toHaveAttribute('data-pinned', 'true');
    await waitForPanTarget();
    await page.mouse.click(resumedPinAnchor.x, resumedPinAnchor.y, {button: 'left'});
    await expect(probabilityTooltip).toHaveAttribute('data-pinned', 'true');
    await page.keyboard.press('Escape');
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await expect(probabilityTooltip).toHaveAttribute('data-pinned', 'false');
    await waitForPanReset();

    await page.setViewportSize({width: 375, height: 900});
    await expect.poll(() => page.evaluate(() => (
        document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack')?.clientWidth || 0
    ))).toBeLessThan(400);
    const visibleNoticeClose = page.locator(
        '[data-dismissible-notice]:not([hidden]) .notice-close',
    ).first();
    if (await visibleNoticeClose.isVisible()) {
        await visibleNoticeClose.click();
    }
    await setSidebarExpanded(page, false);
    await expect.poll(() => page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const card = rect('.backtest-trade-performance-card');
        const stack = rect('.trade-chart-stack');
        const resizer = rect('#backtest_section_resizer');
        const history = rect('#backtest_history_surface');
        return Boolean(
            card
            && stack
            && resizer
            && history
            && card.height >= 300
            && stack.height >= 254
            && stack.bottom <= card.bottom + 2
            && card.bottom <= resizer.top + 2
            && history.top >= resizer.bottom - 2,
        );
    }), {timeout: 10_000}).toBe(true);
    await priceCanvas.evaluate((element) => element.scrollIntoView({block: 'center', inline: 'nearest'}));
    await waitForChartGeometry();
    await expect.poll(async () => {
        const anchor = await pointAt(0.55);
        if (!anchor) return false;
        return page.evaluate(({x, y}) => (
            document.elementFromPoint(x, y) === document.querySelector('#tradePriceChart')
        ), anchor);
    }, {
        message: 'Narrow Bayesian curve anchor must clear the sidebar layout transition',
        timeout: 10_000,
    }).toBe(true);
    await moveToVisiblePriceCurve(0.55, 'Narrow Bayesian hover');

    const narrowLayout = await page.evaluate(() => {
        const results = document.querySelector('.backtest-results-stack');
        const card = document.querySelector('.backtest-trade-performance-card');
        const stack = document.querySelector('.trade-chart-stack');
        const resizer = document.querySelector('#backtest_section_resizer');
        const history = document.querySelector('#backtest_history_surface');
        const canvas = document.querySelector('#tradePriceChart');
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const detailPanel = document.querySelector('#backtest_probability_detail_panel');
        const detailGrid = detailPanel?.querySelector('[data-backtest-probability-detail-grid]');
        const detailCells = Array.from(detailGrid?.querySelectorAll('.backtest-probability-detail-cell') || []);
        const detailGridRect = detailGrid?.getBoundingClientRect();
        const detailViewportRect = detailGrid?.parentElement?.getBoundingClientRect();
        const grid = tooltip?.querySelector('[data-backtest-probability-grid]');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        const chart = window.Chart?.getChart?.(canvas);
        if (!(results instanceof HTMLElement) || !(card instanceof HTMLElement)
            || !(stack instanceof HTMLElement) || !(resizer instanceof HTMLElement)
            || !(history instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)
            || !(tooltip instanceof HTMLElement) || !(grid instanceof HTMLElement)
            || !cells.length || !chart?.chartArea) {
            return null;
        }
        const resultsRect = results.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const stackRect = stack.getBoundingClientRect();
        const resizerRect = resizer.getBoundingClientRect();
        const historyRect = history.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const bounds = chart._activeBacktestProbabilityGridBounds;
        const first = cells.find((cell) => cell.dataset.row === '0' && cell.dataset.column === '0');
        const nextColumn = cells.find((cell) => cell.dataset.row === '0' && cell.dataset.column === '1');
        const nextRow = cells.find((cell) => cell.dataset.row === '1' && cell.dataset.column === '0');
        const firstRect = first?.getBoundingClientRect();
        const nextColumnRect = nextColumn?.getBoundingClientRect();
        const nextRowRect = nextRow?.getBoundingClientRect();
        const detailCellRects = detailCells.map((cell) => cell.getBoundingClientRect());
        const detailGridFitsViewport = Boolean(detailGridRect && detailViewportRect)
            && detailGridRect.left >= detailViewportRect.left - 0.5
            && detailGridRect.right <= detailViewportRect.right + 0.5
            && detailGridRect.top >= detailViewportRect.top - 0.5
            && detailGridRect.bottom <= detailViewportRect.bottom + 0.5;
        const finiteY = chart.getDatasetMeta(0).data
            .map((point) => Number(point?.y))
            .filter(Number.isFinite);
        return {
            cardToResizerGap: resizerRect.top - cardRect.bottom,
            detailCellSizesPositive: detailCellRects.every((rect) => rect.width > 0 && rect.height > 0 && Math.abs(rect.width - rect.height) <= 0.1),
            detailCellCount: detailCells.length,
            detailCellSizes: detailCellRects.slice(0, 5).map((rect) => ({width: rect.width, height: rect.height, x: rect.x, y: rect.y})),
            detailGridWidth: detailGrid?.getBoundingClientRect().width ?? Number.NaN,
            detailGridFitsViewport,
            detailRows: Number(detailGrid?.dataset.rowCount),
            detailTopInset: detailViewportRect && detailGridRect
                ? detailGridRect.top - detailViewportRect.top
                : Number.NaN,
            detailBottomInset: detailViewportRect && detailGridRect
                ? detailViewportRect.bottom - detailGridRect.bottom
                : Number.NaN,
            detailHidden: detailPanel instanceof HTMLElement ? detailPanel.hidden : true,
            detailXTickCount: detailPanel?.querySelectorAll('[data-backtest-probability-detail-x-tick]').length || 0,
            cellSquareDelta: Math.max(...cells.map((cell) => {
                const rect = cell.getBoundingClientRect();
                return Math.abs(rect.width - rect.height);
            })),
            columns: new Set(cells.map((cell) => cell.dataset.column)).size,
            daysPerColumn: Number(grid.dataset.daysPerColumn),
            horizontalGap: firstRect && nextColumnRect
                ? nextColumnRect.left - firstRect.right
                : Number.NaN,
            horizontalOverflow: document.documentElement.scrollWidth
                - document.documentElement.clientWidth,
            historyToResultsBottom: resultsRect.bottom - historyRect.bottom,
            leftInset: tooltipRect.left - stackRect.left,
            pricePixelSpan: finiteY.length ? Math.max(...finiteY) - Math.min(...finiteY) : 0,
            resizerToHistoryGap: historyRect.top - resizerRect.bottom,
            resultsHeight: resultsRect.height,
            rightInset: stackRect.right - tooltipRect.right,
            stackBottomInset: cardRect.bottom - stackRect.bottom,
            fieldToGuideDelta: Math.abs(tooltipRect.left - (
                document.querySelector('.trade-chart-hover-line').getBoundingClientRect().left + 0.5
            )),
            stackHeight: stackRect.height,
            stackTopInset: stackRect.top - cardRect.top,
            rowsDown: new Set(cells.filter((cell) => cell.classList.contains('is-down'))
                .map((cell) => cell.dataset.row)).size,
            rowsUp: new Set(cells.filter((cell) => cell.classList.contains('is-up'))
                .map((cell) => cell.dataset.row)).size,
            slotLatticeDelta: bounds
                ? Math.abs(
                    ((bounds.cellSize + bounds.gap) / bounds.stepPixels) - bounds.daysPerColumn,
                )
                : Number.POSITIVE_INFINITY,
            tooltipBottomInset: stackRect.bottom - tooltipRect.bottom,
            tooltipTopInset: tooltipRect.top - stackRect.top,
            tooltipWidth: tooltipRect.width,
            verticalGap: firstRect && nextRowRect
                ? nextRowRect.top - firstRect.bottom
                : Number.NaN,
        };
    });
    expect(narrowLayout).not.toBeNull();
    expect(narrowLayout.detailHidden).toBe(false);
    expect(narrowLayout.detailGridWidth).toBeGreaterThan(0);
    expect(narrowLayout.detailGridFitsViewport).toBe(true);
    expect(narrowLayout.detailCellCount).toBe(narrowLayout.detailRows * 20);
    expect(narrowLayout.detailRows).toBe(24);
    expect(narrowLayout.detailTopInset).toBeGreaterThanOrEqual(-1);
    expect(narrowLayout.detailBottomInset).toBeGreaterThanOrEqual(-1);
    expect(narrowLayout.detailCellSizesPositive).toBe(true);
    expect(narrowLayout.detailXTickCount).toBeGreaterThanOrEqual(1);
    expect(narrowLayout.detailXTickCount).toBeLessThanOrEqual(9);
    expect(narrowLayout.resultsHeight).toBeGreaterThanOrEqual(599);
    expect(narrowLayout.stackHeight).toBeGreaterThanOrEqual(253);
    expect(narrowLayout.pricePixelSpan).toBeGreaterThanOrEqual(24);
    expect(narrowLayout.cardToResizerGap, 'card-to-resizer gap')
        .toBeGreaterThanOrEqual(-0.75);
    expect(narrowLayout.resizerToHistoryGap, 'resizer-to-history gap')
        .toBeGreaterThanOrEqual(-0.75);
    expect(narrowLayout.stackTopInset, 'chart stack top inset')
        .toBeGreaterThanOrEqual(-0.75);
    expect(narrowLayout.stackBottomInset, 'chart stack bottom inset')
        .toBeGreaterThanOrEqual(-2.1);
    expect(narrowLayout.tooltipTopInset, 'probability field top inset')
        .toBeGreaterThanOrEqual(-0.75);
    expect(narrowLayout.tooltipBottomInset, 'probability field bottom inset')
        .toBeGreaterThanOrEqual(-0.75);
    expect(narrowLayout.historyToResultsBottom, 'history-to-results bottom inset')
        .toBeGreaterThanOrEqual(-0.75);
    expect(narrowLayout.leftInset, 'probability field left inset')
        .toBeGreaterThanOrEqual(0);
    expect(narrowLayout.fieldToGuideDelta, 'narrow field must retain its guide-owned origin')
        .toBeLessThanOrEqual(1);
    expect(narrowLayout.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(narrowLayout.rowsUp).toBeGreaterThan(0);
    expect(narrowLayout.rowsDown).toBeGreaterThan(0);
    expect(narrowLayout.rowsUp).toBeLessThanOrEqual(12);
    expect(narrowLayout.rowsDown).toBeLessThanOrEqual(12);
    expect(narrowLayout.columns).toBe(20);
    expect(narrowLayout.cellSquareDelta).toBeLessThanOrEqual(0.1);
    expect(narrowLayout.horizontalGap).toBeCloseTo(2, 1);
    expect(narrowLayout.verticalGap).toBeCloseTo(2, 1);
    expect(Number.isInteger(narrowLayout.daysPerColumn)).toBe(true);
    expect(narrowLayout.daysPerColumn).toBeGreaterThanOrEqual(1);
    expect(narrowLayout.slotLatticeDelta).toBeLessThanOrEqual(1e-9);

    const secondNarrowAnchor = await pointAt(0.72);
    if (!secondNarrowAnchor) throw new Error('Second narrow Bayesian hover anchor is unavailable.');
    await page.mouse.move(secondNarrowAnchor.x, secondNarrowAnchor.y);
    await waitForPanTarget();
    const secondNarrowWidth = await probabilityTooltip.evaluate((tooltip) => (
        tooltip.getBoundingClientRect().width
    ));
    expect(Math.abs(secondNarrowWidth - narrowLayout.tooltipWidth)).toBeLessThanOrEqual(0.1);

    await page.mouse.move(10, 10);
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await waitForPanReset();

    const lifecycle = await page.evaluate(() => {
        const priceCanvasElement = document.querySelector('#tradePriceChart');
        const equityCanvasElement = document.querySelector('#tradeEquityChart');
        const oldPriceChart = window.Chart?.getChart?.(priceCanvasElement);
        const oldEquityChart = window.Chart?.getChart?.(equityCanvasElement);
        window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
        const newPriceChart = window.Chart?.getChart?.(priceCanvasElement);
        const newEquityChart = window.Chart?.getChart?.(equityCanvasElement);
        const stack = priceCanvasElement?.closest('.trade-chart-stack');
        return {
            oldEquityDestroyed: oldEquityChart?.ctx === null,
            oldPriceDestroyed: oldPriceChart?.ctx === null,
            replacedEquityChart: Boolean(newEquityChart && newEquityChart !== oldEquityChart),
            replacedPriceChart: Boolean(newPriceChart && newPriceChart !== oldPriceChart),
            scrollLeft: stack?.scrollLeft,
            spacerCount: document.querySelectorAll('[data-backtest-probability-scroll-spacer]').length,
            tooltipCount: document.querySelectorAll('[data-backtest-chart-tooltip="probability-grid"]').length,
        };
    });
    expect(lifecycle).toEqual({
        oldEquityDestroyed: true,
        oldPriceDestroyed: true,
        replacedEquityChart: true,
        replacedPriceChart: true,
        scrollLeft: 0,
        spacerCount: 1,
        tooltipCount: 1,
    });

    await page.evaluate(() => {
        const result = window.WORTHWARD_APP?.backtestResult;
        if (!result?.strategy_presentation) {
            throw new Error('Bayesian presentation is unavailable for custom material verification.');
        }
        result.strategy_presentation = {
            ...result.strategy_presentation,
            rows_above: 4,
            rows_below: 4,
            columns: 18,
            width_fraction: 0.3,
            gap_px: 2.5,
            padding_px: 6,
            min_cell_px: 3,
            cell_radius_px: 1.5,
            cell_opacity_exponent: 2.4,
            cell_opacity_tail_ratio: 0.05,
        };
        window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
        window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
    });
    await waitForChartGeometry();
    const customAnchor = await pointAt(0.05);
    if (!customAnchor) throw new Error('Custom Bayesian hover anchor is unavailable.');
    await page.mouse.move(customAnchor.x, customAnchor.y);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    await waitForPanTarget();
    const customPresentation = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const grid = tooltip?.querySelector('[data-backtest-probability-grid]');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        if (!(canvas instanceof HTMLCanvasElement) || !chart
            || !(tooltip instanceof HTMLElement) || !(grid instanceof HTMLElement)
            || !cells.length) return null;
        const tooltipStyle = getComputedStyle(tooltip);
        const firstCellStyle = getComputedStyle(cells[0]);
        const canvasRect = canvas.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const bounds = chart._activeBacktestProbabilityGridBounds;
        const guide = chart._activeBacktestPriceGuideBounds;
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = 1;
        colorCanvas.height = 1;
        const colorContext = colorCanvas.getContext('2d', {willReadFrequently: true});
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = tooltipStyle.backgroundColor;
        colorContext.fillRect(0, 0, 1, 1);
        return {
            backgroundAlpha: colorContext.getImageData(0, 0, 1, 1).data[3] / 255,
            cellBorderRadius: firstCellStyle.borderRadius,
            cellCount: cells.length,
            cellMinimumSize: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
            centerDelta: Math.abs(
                (tooltipRect.top + (tooltipRect.height / 2)) - (canvasRect.top + guide.y)
            ),
            guideBottomInset: tooltipRect.bottom - (canvasRect.top + guide.y),
            guideTopInset: (canvasRect.top + guide.y) - tooltipRect.top,
            columns: Number(grid.dataset.columnCount),
            gap: bounds?.gap,
            horizontalGap: cells.length > 1
                ? cells[1].getBoundingClientRect().left - cells[0].getBoundingClientRect().right
                : null,
            opacityExponent: Number(tooltip.dataset.cellOpacityExponent),
            opacityMapping: tooltip.dataset.cellOpacityMapping,
            opacityTailRatio: Number(tooltip.dataset.cellOpacityTailRatio),
            gridPadding: getComputedStyle(grid).paddingTop,
            outerBorderRadius: tooltipStyle.borderRadius,
            rows: Number(grid.dataset.rowCount),
            availableRowsAbove: bounds?.availableRowsAbove,
            availableRowsBelow: bounds?.availableRowsBelow,
            rowsAbove: bounds?.rowsAbove,
            rowsBelow: bounds?.rowsBelow,
        };
    });
    expect(customPresentation).toEqual(expect.objectContaining({
        cellBorderRadius: '0px',
        cellCount: customPresentation.rows * customPresentation.columns,
        columns: 20,
        gap: 2,
        horizontalGap: 2,
        gridPadding: '6px',
        opacityExponent: 2.4,
        opacityMapping: 'instant-contrast-power-v1',
        opacityTailRatio: 0.05,
        outerBorderRadius: '0px',
        rows: customPresentation.rowsAbove + customPresentation.rowsBelow,
        rowsAbove: 4,
        rowsBelow: customPresentation.rowsBelow,
    }));
    expect(customPresentation.cellMinimumSize).toBeGreaterThanOrEqual(3.99);
    expect(customPresentation.rowsAbove).toBeLessThanOrEqual(4);
    expect(customPresentation.rowsBelow).toBeGreaterThan(0);
    expect(customPresentation.rowsBelow).toBeLessThanOrEqual(4);
    expect(customPresentation.rowsAbove).toBeLessThanOrEqual(customPresentation.availableRowsAbove);
    expect(customPresentation.rowsBelow).toBeLessThanOrEqual(customPresentation.availableRowsBelow);
    expect(customPresentation.backgroundAlpha).toBe(0);
    expect(customPresentation.centerDelta).toBeGreaterThanOrEqual(0);
    expect(customPresentation.guideTopInset).toBeGreaterThanOrEqual(0);
    expect(customPresentation.guideBottomInset).toBeGreaterThanOrEqual(0);

    await page.evaluate(() => {
        const result = window.WORTHWARD_APP?.backtestResult;
        if (!result?.strategy_presentation) throw new Error('Bayesian presentation is unavailable for threshold verification.');
        result.strategy_presentation = {
            ...result.strategy_presentation,
            cell_display_threshold_pct: 50,
        };
        window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
        window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
    });
    await waitForChartGeometry();
    const thresholdAnchor = await pointAt(0.05);
    if (!thresholdAnchor) throw new Error('Bayesian threshold hover anchor is unavailable.');
    await page.mouse.move(thresholdAnchor.x, thresholdAnchor.y);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    const thresholdContract = await page.evaluate(() => {
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        const detailPanel = document.querySelector('#backtest_probability_detail_panel');
        const detailCells = Array.from(detailPanel?.querySelectorAll('.backtest-probability-detail-cell') || []);
        const hiddenCells = cells.filter((cell) => cell.dataset.thresholdVisible === 'false');
        const hiddenDetailCells = detailCells.filter((cell) => cell.dataset.thresholdVisible === 'false');
        return {
            threshold: Number(tooltip?.dataset.cellDisplayThresholdPct),
            hiddenCount: hiddenCells.length,
            hiddenComputedOpacity: hiddenCells.every((cell) => getComputedStyle(cell).opacity === '0'),
            hiddenAria: hiddenCells.every((cell) => cell.getAttribute('aria-hidden') === 'true'),
            detailHiddenCount: hiddenDetailCells.length,
            detailHiddenComputedOpacity: hiddenDetailCells.every((cell) => getComputedStyle(cell).opacity === '0'),
        };
    });
    expect(thresholdContract.threshold).toBe(50);
    expect(thresholdContract.hiddenCount).toBeGreaterThan(0);
    expect(thresholdContract.hiddenComputedOpacity).toBe(true);
    expect(thresholdContract.hiddenAria).toBe(true);
    expect(thresholdContract.detailHiddenCount).toBeGreaterThanOrEqual(thresholdContract.hiddenCount);
    expect(thresholdContract.detailHiddenComputedOpacity).toBe(true);
}
