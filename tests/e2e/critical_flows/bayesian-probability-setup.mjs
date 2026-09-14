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

export async function prepareBayesianProbabilityField(page) {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 1021, height: 841});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=NVDA&range=6mo&strategy=bayesian-price-field');
    const chartHeading = page.locator('#backtest_overview_panel > .backtest-surface > .chart-heading-row > .chart-heading');
    await expect(chartHeading).toHaveText('Price and strategy analysis');
    await expect.poll(() => chartHeading.evaluate((element) => {
        const style = getComputedStyle(element);
        return {fontSize: style.fontSize, fontWeight: style.fontWeight};
    })).toEqual({fontSize: '20px', fontWeight: '400'});
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    const readBaselineGeometry = () => page.evaluate(() => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const price = document.querySelector('#tradePriceChart')?.getBoundingClientRect();
        const equity = document.querySelector('#tradeEquityChart')?.getBoundingClientRect();
        const resizer = document.querySelector('#backtest_section_resizer')?.getBoundingClientRect();
        const resizerSlot = document.querySelector('[data-backtest-section-resizer-slot]')?.getBoundingClientRect();
        const history = document.querySelector('#backtest_history_surface')?.getBoundingClientRect();
        const stackRect = stack?.getBoundingClientRect();
        return price && equity && resizer && resizerSlot && history && stack instanceof HTMLElement && stackRect ? {
            equityHeight: equity.height,
            equityLeft: equity.left,
            equityTop: equity.top,
            historyTop: history.top,
            priceHeight: price.height,
            priceLeft: price.left,
            priceTop: price.top,
            priceWidth: price.width,
            resizerHeight: resizer.height,
            resizerTop: resizer.top,
            resizerSlotHeight: resizerSlot.height,
            resizerSlotTop: resizerSlot.top,
            stackClientHeight: stack.clientHeight,
            stackHeight: stackRect.height,
            stackLeft: stackRect.left,
        } : null;
    });
    let baselineGeometry = await readBaselineGeometry();
    expect(baselineGeometry).not.toBeNull();
    await expect.poll(() => page.evaluate(() => {
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        return scrollPort instanceof HTMLElement && scrollPort.hidden;
    })).toBe(true);

    await page.evaluate(() => {
        const result = window.WORTHWARD_APP?.backtestResult;
        if (!result?.chart) throw new Error('Backtest chart shell is unavailable.');

        const rawDates = [];
        const cursor = new Date('2026-01-02T00:00:00Z');
        while (rawDates.length < 80) {
            const weekday = cursor.getUTCDay();
            if (weekday !== 0 && weekday !== 6) rawDates.push(cursor.toISOString().slice(0, 10));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        const close = rawDates.map((_, index) => (
            120 + (index * 0.22) + (Math.sin(index / 4) * 3.2)
        ));
        const equity = close.map((value, index) => 10_000 + ((value - close[0]) * 54) + (index * 4));
        result.interval = '1d';
        result.multi_asset = false;
        result.trades = [];
        result.summary = {
            ...(result.summary || {}),
            ticker: 'NVDA',
            initial_capital: 10_000,
        };
        result.chart = {
            ...(result.chart || {}),
            dates: [...rawDates],
            raw_dates: [...rawDates],
            open: close.map((value) => value - 0.8),
            high: close.map((value) => value + 1.4),
            low: close.map((value) => value - 1.6),
            close,
            equity,
            all_in_equity: equity.map((value, index) => value + (index * 2)),
        };
        result.strategy_presentation = {
            schema: 'bayesian-price-field/v1',
            renderer: 'probability-grid-v1',
            rows_above: 10,
            rows_below: 10,
            columns: 20,
            width_fraction: 0.25,
            gap_px: 2,
            padding_px: 8,
            min_cell_px: 4,
            cell_radius_px: 2,
            tooltip_radius_px: 10,
            tooltip_transparency_pct: 50,
            cell_opacity_mapping: 'instant-contrast-power-v1',
            cell_opacity_exponent: 1.6,
            cell_opacity_tail_ratio: 0.02,
            cell_display_threshold_pct: 0,
            time_quantization: 'integer-trading-days',
            distribution_kind: 'dynamic-normal-log-return',
            target_interval: 'next-open-to-following-open',
            price_anchor_kind: 'signal-close-display-anchor',
            multi_step_kind: 'causal-ar1-return-state',
            return_autoregression: rawDates.map((_, index) => (index < 3 ? null : 0.5)),
            return_long_run_mean: rawDates.map((_, index) => (index < 3 ? null : 0)),
            return_innovation_scale: rawDates.map((_, index) => (index < 3 ? null : 0.012)),
            data_keys: [...rawDates],
            predictive_mean: rawDates.map((_, index) => (index < 3 ? null : 0.0015)),
            predictive_scale: rawDates.map((_, index) => (index < 3 ? null : 0.018)),
        };
        window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
        window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
    });

    const historySurface = page.locator('#backtest_history_surface');
    const metricsTab = page.locator('#backtest_history_metrics');
    const priceFieldTab = page.locator('#backtest_history_probability');
    const detailPanel = page.locator('#backtest_probability_detail_panel');
    await expect(priceFieldTab).toHaveCount(1);
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'transactions');
    await page.locator('label[for="backtest_history_metrics"]').click();
    await expect(metricsTab).toBeChecked();
    await expect(historySurface).toHaveAttribute('data-active-view', 'metrics');
    await expect(page.locator('#backtest_history_metrics_panel')).toBeVisible();
    await expect(detailPanel).toBeHidden();
    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(priceFieldTab).toBeChecked();
    await expect(historySurface).toHaveAttribute('data-active-view', 'probability');
    await expect(page.locator('#backtest_history_metrics_panel')).toBeHidden();
    await expect(page.locator('#backtest_history_transactions_panel')).toBeHidden();
    await expect(detailPanel).toBeVisible();
    const readDetailColorBoundary = () => page.evaluate(() => {
        const panel = document.querySelector('#backtest_probability_detail_panel');
        const anchor = panel?.querySelector('[data-backtest-probability-detail-anchor]');
        const grid = panel?.querySelector('[data-backtest-probability-detail-grid]');
        const anchorRect = anchor?.getBoundingClientRect();
        const cells = Array.from(grid?.querySelectorAll('.backtest-probability-detail-cell') || []);
        const upCells = cells.filter((cell) => cell.classList.contains('is-up'));
        const downCells = cells.filter((cell) => cell.classList.contains('is-down'));
        return {
            activeIndex: Number(panel?.dataset.activeIndex),
            cellCount: cells.length,
            downCount: downCells.length,
            downViolations: anchorRect
                ? downCells.filter((cell) => (
                    cell.getBoundingClientRect().top < anchorRect.bottom - 0.51
                )).length
                : Number.POSITIVE_INFINITY,
            panelHidden: panel instanceof HTMLElement ? panel.hidden : true,
            upCount: upCells.length,
            upViolations: anchorRect
                ? upCells.filter((cell) => (
                    cell.getBoundingClientRect().bottom > anchorRect.top + 0.51
                )).length
                : Number.POSITIVE_INFINITY,
        };
    });
    const expectDetailColorBoundary = async (label) => {
        await expect.poll(async () => {
            const result = await readDetailColorBoundary();
            return result.panelHidden === false
                && result.cellCount > 0
                && result.upCount + result.downCount === result.cellCount
                && result.upViolations === 0
                && result.downViolations === 0;
        }, {message: label}).toBe(true);
    };
    await expectDetailColorBoundary('Initial Bayesian detail cells must stay on their price side');

    const priceCanvas = page.locator('#tradePriceChart');
    const probabilityTooltip = page.locator('[data-backtest-chart-tooltip="probability-grid"]');
    const summaryTooltip = page.locator('[data-backtest-chart-tooltip="summary"]');
    await expect(priceCanvas).toBeVisible();
    await expect(probabilityTooltip).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
            ?.getDatasetMeta?.(0)?.data?.length || 0
    ))).toBe(80);

    const pointAt = async (ratio, canvasSelector = '#tradePriceChart') => page.evaluate(
        ({targetRatio, selector}) => {
            const canvas = document.querySelector(selector);
            const chart = window.Chart?.getChart?.(canvas);
            const points = chart?.getDatasetMeta?.(0)?.data || [];
            const index = Math.max(
                0,
                Math.min(points.length - 1, Math.round((points.length - 1) * targetRatio)),
            );
            const point = points[index];
            const rect = canvas?.getBoundingClientRect();
            const chartWidth = Number(chart?.width);
            const chartHeight = Number(chart?.height);
            if (!point || !rect || !(chartWidth > 0) || !(chartHeight > 0)) return null;
            return {
                index,
                x: rect.left + (point.x * (rect.width / chartWidth)),
                y: rect.top + (point.y * (rect.height / chartHeight)),
            };
        },
        {targetRatio: ratio, selector: canvasSelector},
    );
    const pointAtIndex = async (index, canvasSelector = '#tradePriceChart') => page.evaluate(
        ({targetIndex, selector}) => {
            const canvas = document.querySelector(selector);
            const chart = window.Chart?.getChart?.(canvas);
            const points = chart?.getDatasetMeta?.(0)?.data || [];
            const rect = canvas?.getBoundingClientRect();
            const chartWidth = Number(chart?.width);
            const chartHeight = Number(chart?.height);
            const pointIndex = Math.max(0, Math.min(points.length - 1, Number(targetIndex)));
            const point = points[pointIndex];
            if (!point || !rect || !(chartWidth > 0) || !(chartHeight > 0)) return null;
            return {
                index: pointIndex,
                x: rect.left + (point.x * (rect.width / chartWidth)),
                y: rect.top + (point.y * (rect.height / chartHeight)),
            };
        },
        {targetIndex: index, selector: canvasSelector},
    );
    const waitForChartGeometry = async () => {
        await expect.poll(() => page.evaluate(() => {
            const canvas = document.querySelector('#tradePriceChart');
            const chart = window.Chart?.getChart?.(canvas);
            const rect = canvas?.getBoundingClientRect();
            return Boolean(
                canvas instanceof HTMLCanvasElement
                && chart?.chartArea
                && rect
                && Math.abs(rect.width - Number(chart.width)) <= 1
                && Math.abs(rect.height - Number(chart.height)) <= 1
                && chart.chartArea.right > chart.chartArea.left
                && chart.chartArea.bottom > chart.chartArea.top,
            );
        }), {timeout: 10_000}).toBe(true);
    };
    const pointNearestPriceChartCenter = async () => page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        const rect = canvas?.getBoundingClientRect();
        const chartArea = chart?.chartArea;
        const chartWidth = Number(chart?.width);
        const chartHeight = Number(chart?.height);
        if (!(canvas instanceof HTMLCanvasElement) || !rect || !chartArea
            || !(chartWidth > 0) || !(chartHeight > 0) || points.length < 4) {
            return null;
        }
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const predictiveMean = Array.isArray(presentation?.predictive_mean)
            ? presentation.predictive_mean
            : [];
        const predictiveScale = Array.isArray(presentation?.predictive_scale)
            ? presentation.predictive_scale
            : [];
        const centerY = (chartArea.top + chartArea.bottom) / 2;
        const candidates = points
            .map((point, index) => ({index, point}))
            .filter(({index, point}) => (
                Number.isFinite(point?.x)
                && Number.isFinite(point?.y)
                && predictiveMean[index] !== null
                && predictiveMean[index] !== undefined
                && predictiveScale[index] !== null
                && predictiveScale[index] !== undefined
                && Number.isFinite(Number(predictiveMean[index]))
                && Number.isFinite(Number(predictiveScale[index]))
            ));
        if (!candidates.length) return null;
        const nearest = candidates.reduce((best, candidate) => (
            Math.abs(candidate.point.y - centerY) < Math.abs(best.point.y - centerY)
                ? candidate
                : best
        ));
        return {
            index: nearest.index,
            x: rect.left + (nearest.point.x * (rect.width / chartWidth)),
            y: rect.top + (nearest.point.y * (rect.height / chartHeight)),
        };
    });
    const moveToVisiblePriceCurve = async (ratio, label) => {
        const anchor = await pointAt(ratio);
        if (!anchor) throw new Error(`${label} curve anchor is unavailable.`);
        const hitTarget = await page.evaluate(({x, y}) => {
            const canvas = document.querySelector('#tradePriceChart');
            const stack = canvas?.closest('.trade-chart-stack');
            const canvasWrap = canvas?.closest('.trade-chart-canvas-wrap');
            const chart = window.Chart?.getChart?.(canvas);
            if (!(canvas instanceof HTMLCanvasElement)
                || !(stack instanceof HTMLElement)
                || !(canvasWrap instanceof HTMLElement)
                || !chart?.chartArea) return null;
            const stackRect = stack.getBoundingClientRect();
            const canvasWrapRect = canvasWrap.getBoundingClientRect();
            const cropLeft = Math.max(0, stackRect.left + stack.clientLeft, canvasWrapRect.left);
            const cropRight = Math.min(
                window.innerWidth,
                stackRect.left + stack.clientLeft + stack.clientWidth,
                canvasWrapRect.right,
            );
            const cropTop = Math.max(0, stackRect.top + stack.clientTop, canvasWrapRect.top);
            const cropBottom = Math.min(
                window.innerHeight,
                stackRect.top + stack.clientTop + stack.clientHeight,
                canvasWrapRect.bottom,
            );
            const canvasRect = canvas.getBoundingClientRect();
            const chartX = (x - canvasRect.left) * (chart.width / canvasRect.width);
            const chartY = (y - canvasRect.top) * (chart.height / canvasRect.height);
            return {
                hitsChartArea: chartX >= chart.chartArea.left && chartX <= chart.chartArea.right
                    && chartY >= chart.chartArea.top && chartY <= chart.chartArea.bottom,
                hitsPriceCanvas: document.elementFromPoint(x, y) === canvas,
                insideVisibleCrop: x >= cropLeft + 2 && x <= cropRight - 2
                    && y >= cropTop + 2 && y <= cropBottom - 2,
            };
        }, anchor);
        expect(hitTarget, `${label} anchor must be inside the visible price canvas crop`).toEqual({
            hitsChartArea: true,
            hitsPriceCanvas: true,
            insideVisibleCrop: true,
        });
        await page.mouse.move(anchor.x, anchor.y);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await waitForPanTarget();
        anchor.index = await readVisibleIndexAtPointer(anchor.x);
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
                ?._activeBacktestProbabilityGridBounds?.index
        ))).toBe(anchor.index);
        await expect.poll(() => page.evaluate(() => {
            const canvas = document.querySelector('#tradePriceChart');
            const chart = window.Chart?.getChart?.(canvas);
            const activePoint = chart?._active?.[0]?.element
                || chart?.getActiveElements?.()[0]?.element;
            return Number(
                activePoint?.options?.radius
                ?? activePoint?.radius
                ?? chart?.data?.datasets?.[0]?.pointHoverRadius
                ?? Number.NaN,
            );
        }), {message: `${label} hover point must remain invisible`}).toBe(0);
        return anchor;
    };
    const panSnapshot = () => page.evaluate(() => {
        const stack = document.querySelector('#tradePriceChart')?.closest('.trade-chart-stack');
        const scrollPort = document.querySelector('[data-backtest-probability-scrollport]');
        if (!(stack instanceof HTMLElement)) return null;
        return {
            clientHeight: stack.clientHeight,
            clientWidth: stack.clientWidth,
            motion: stack.dataset.probabilityPanMotion || '',
            overflowX: getComputedStyle(stack).overflowX,
            portActive: scrollPort instanceof HTMLElement && !scrollPort.hidden,
            portAriaHidden: scrollPort instanceof HTMLElement
                ? scrollPort.getAttribute('aria-hidden')
                : null,
            portClientWidth: scrollPort instanceof HTMLElement ? scrollPort.clientWidth : 0,
            portScrollLeft: scrollPort instanceof HTMLElement ? scrollPort.scrollLeft : 0,
            portScrollWidth: scrollPort instanceof HTMLElement ? scrollPort.scrollWidth : 0,
            scrollLeft: stack.scrollLeft,
            scrollWidth: stack.scrollWidth,
            state: stack.dataset.probabilityPanState || '',
            target: Number(stack.dataset.probabilityPanTarget || 0),
            visualOffset: Number(stack.dataset.probabilityPanVisualOffset || 0),
            visualPosition: Number(stack.dataset.probabilityPanVisualPosition || 0),
        };
    });
    // Native rails use integral CSS scroll offsets. The controller applies the
    // same subpixel correction to every chart visual so the logical pan target
    // remains the exact missing floating width.
    const probabilityScrollPositionTolerance = 1.1;
    const probabilityScrollTargetTolerance = 0.05;
    const waitForPanTarget = async () => {
        await expect.poll(async () => {
            const snapshot = await panSnapshot();
            return snapshot
                ? Math.abs(snapshot.visualPosition - snapshot.target)
                : Number.POSITIVE_INFINITY;
        }).toBeLessThanOrEqual(probabilityScrollTargetTolerance);
        await expect.poll(async () => {
            const snapshot = await panSnapshot();
            return snapshot
                ? Math.max(
                    Math.abs(snapshot.scrollLeft - snapshot.target),
                    Math.abs(snapshot.portScrollLeft - snapshot.target),
                )
                : Number.POSITIVE_INFINITY;
        }).toBeLessThanOrEqual(probabilityScrollPositionTolerance);
    };
    const waitForPanReset = async () => {
        await expect.poll(async () => {
            const snapshot = await panSnapshot();
            return snapshot;
        }).toMatchObject({
            overflowX: 'hidden',
            portActive: false,
            portAriaHidden: 'true',
            portScrollLeft: 0,
            scrollLeft: 0,
            target: 0,
            visualOffset: 0,
            visualPosition: 0,
        });
    };
    const movePointerOutsideProbabilitySurface = async () => {
        await page.mouse.move(1, 1);
        await waitForPanReset();
    };
    const readSelectedDateStatus = (index) => page.evaluate((expectedIndex) => {
        const rawDates = window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates || [];
        const rawDate = rawDates[expectedIndex];
        const match = typeof rawDate === 'string'
            ? /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate)
            : null;
        const formatter = window.WORTHWARD_BOOTSTRAP?.dateDisplay?.formatFullDateParts;
        const expectedStatus = match && typeof formatter === 'function'
            ? `Selected date: ${formatter({
                year: Number(match[1]),
                monthIndex: Number(match[2]) - 1,
                day: Number(match[3]),
            }, {includeTime: false})}`
            : null;
        return {
            activeIndex: Number(
                document.querySelector('#backtest_probability_detail_panel')?.dataset.activeIndex,
            ),
            boundsIndex: window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
                ?._activeBacktestProbabilityGridBounds?.index,
            expectedStatus,
            status: document.querySelector('[data-backtest-probability-detail-status]')
                ?.textContent?.trim() || '',
        };
    }, index);
    const readVisibleTraversalSamples = () => page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const stack = canvas?.closest('.trade-chart-stack');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const stackRect = stack?.getBoundingClientRect();
        const chartArea = chart?.chartArea;
        const chartWidth = Number(chart?.width);
        const chartHeight = Number(chart?.height);
        if (!(canvas instanceof HTMLCanvasElement) || !(stack instanceof HTMLElement)
            || !rect || !stackRect || !chartArea
            || !(chartWidth > 0) || !(chartHeight > 0)) return [];
        const scaleX = rect.width / chartWidth;
        const scaleY = rect.height / chartHeight;
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const seriesKeys = [
            'predictive_mean',
            'predictive_scale',
            'return_autoregression',
            'return_long_run_mean',
            'return_innovation_scale',
        ];
        const hasFiniteModelValue = (value) => (
            value !== null && value !== undefined && Number.isFinite(Number(value))
        );
        const plotLeft = rect.left + (chartArea.left * scaleX);
        const plotRight = rect.left + (chartArea.right * scaleX);
        const visibleLeft = Math.max(stackRect.left + 2, plotLeft + 2);
        const visibleRight = Math.min(stackRect.right - 2, plotRight - 2);
        const finitePoints = (chart?.getDatasetMeta?.(0)?.data || [])
            .map((point, index) => ({index, point}))
            .filter(({index, point}) => (
                Number.isFinite(point?.x)
                && Number.isFinite(point?.y)
                && seriesKeys.every((key) => hasFiniteModelValue(presentation?.[key]?.[index]))
            ))
            .filter(({point}) => {
                const visualX = rect.left + (point.x * scaleX);
                return visualX >= visibleLeft && visualX <= visibleRight;
            });
        if (finitePoints.length < 2) return [];
        const sampleCount = Math.min(11, finitePoints.length);
        const sampleIndices = Array.from({length: sampleCount}, (_, sampleIndex) => (
            Math.round((finitePoints.length - 1) * (sampleIndex / Math.max(1, sampleCount - 1)))
        ));
        const sweepY = rect.top + (((chartArea.top + chartArea.bottom) / 2) * scaleY);
        return Array.from(new Set(sampleIndices)).map((finitePointIndex) => {
            const {index, point} = finitePoints[finitePointIndex];
            return {
                index,
                x: rect.left + (point.x * scaleX),
                y: sweepY,
            };
        });
    });

    const warmup = await pointAt(0);
    if (!warmup) throw new Error('Bayesian warmup anchor is unavailable.');
    await page.mouse.move(warmup.x, warmup.y);
    await expect(probabilityTooltip).not.toHaveClass(/is-visible/);
    await page.mouse.click(warmup.x, warmup.y);
    await expect(probabilityTooltip).not.toHaveAttribute('data-pinned', 'true');
    await waitForPanReset();
    baselineGeometry = await readBaselineGeometry();
    expect(baselineGeometry).not.toBeNull();

    const traversalSamples = await readVisibleTraversalSamples();
    expect(traversalSamples.length).toBeGreaterThanOrEqual(8);
    const readVisibleIndexAtPointer = (pointerX) => page.evaluate((x) => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas.getBoundingClientRect();
        // Native mousemove exposes integer clientX even for fractional CDP input.
        const chartX = (Math.trunc(x) - rect.left) * chart.width / rect.width;
        return chart.getDatasetMeta(0).data
            .map((point, index) => ({point, index}))
            .filter(({point}) => Number.isFinite(point.x) && Number.isFinite(point.y))
            .reduce((best, candidate) => (
                Math.abs(candidate.point.x - chartX) < Math.abs(best.point.x - chartX)
                    ? candidate : best
            )).index;
    }, pointerX);
    const hoverExactIndex = async (index) => {
        const point = await pointAtIndex(index);
        await page.mouse.move(point.x, point.y);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const pointer = await page.evaluate((targetIndex) => {
            const canvas = document.querySelector('#tradePriceChart');
            const chart = window.Chart.getChart(canvas);
            const rect = canvas.getBoundingClientRect();
            const stack = canvas.closest('.trade-chart-stack');
            const stackRect = stack.getBoundingClientRect();
            const point = chart.getDatasetMeta(0).data[targetIndex];
            const pan = Number(stack.dataset.probabilityPanVisualPosition || 0);
            const fieldWidth = chart._activeBacktestProbabilityGridBounds.width;
            const contentX = rect.left - stackRect.left + pan + point.x * rect.width / chart.width;
            return {index: targetIndex,
                x: Math.round(stackRect.left + Math.min(
                    contentX, (contentX + stackRect.width - fieldWidth) / 2,
                )),
                y: rect.top + point.y * rect.height / chart.height};
        }, index);
        await page.mouse.move(pointer.x, pointer.y);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        return pointer;
    };
    const observedTraversalIndices = [];
    for (const sample of traversalSamples) {
        // Independently intersect the settled visible curve, not its pre-pan position.
        await page.mouse.move(sample.x, sample.y);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await waitForPanTarget();
        const visibleIndex = await readVisibleIndexAtPointer(sample.x);
        const selected = await readSelectedDateStatus(visibleIndex);
        expect(selected.boundsIndex).toBe(visibleIndex);
        expect(selected.activeIndex).toBe(visibleIndex);
        expect(selected.expectedStatus).toBeTruthy();
        expect(selected.status).toBe(selected.expectedStatus);
        observedTraversalIndices.push(visibleIndex);
    }
    expect(observedTraversalIndices).toEqual([...observedTraversalIndices].sort((a, b) => a - b));
    const endpointIndex = await page.evaluate(() => (
        window.Chart.getChart(document.querySelector('#tradePriceChart'))
            .getDatasetMeta(0).data.length - 1
    ));
    observedTraversalIndices.forEach((index, position) => {
        if (position > 0 && index === observedTraversalIndices[position - 1]) {
            expect(index).toBe(endpointIndex);
        }
    });
    await movePointerOutsideProbabilitySurface();

    // Auto-pan must not reinterpret a stationary pointer as a new origin.
    const pannedTraversalSeed = await pointAt(0.8);
    if (!pannedTraversalSeed) throw new Error('Bayesian panned traversal seed is unavailable.');
    await page.mouse.move(pannedTraversalSeed.x, pannedTraversalSeed.y);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await waitForPanTarget();
    const pannedVisibleIndex = await readVisibleIndexAtPointer(pannedTraversalSeed.x);
    await page.mouse.move(pannedTraversalSeed.x, pannedTraversalSeed.y + 5);
    await expect.poll(async () => {
        const selected = await readSelectedDateStatus(pannedVisibleIndex);
        return selected.boundsIndex === pannedVisibleIndex
            && selected.activeIndex === pannedVisibleIndex
            && selected.expectedStatus
            && selected.status === selected.expectedStatus;
    }, {message: 'Auto-pan must preserve the origin during vertical-only pointer movement'}).toBe(true);
    await movePointerOutsideProbabilitySurface();

    const leftAnchor = await pointAt(0.05);
    if (!leftAnchor) throw new Error('Bayesian left-side hover anchor is unavailable.');
    await page.mouse.move(leftAnchor.x, leftAnchor.y);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    await waitForPanTarget();
    const leftHoverAlignment = await page.evaluate(({pointerX, expectedIndex}) => {
        const canvas = document.querySelector('#tradePriceChart');
        const stack = canvas?.closest('.trade-chart-stack');
        const chart = window.Chart?.getChart?.(canvas);
        const hoverLine = document.querySelector('.trade-chart-hover-line');
        const horizontalHoverLine = document.querySelector('.trade-chart-hover-horizontal-line');
        const probabilityField = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const firstProbabilityCell = probabilityField?.querySelector('.backtest-probability-cell');
        const bounds = chart?._activeBacktestProbabilityGridBounds;
        const canvasRect = canvas?.getBoundingClientRect();
        const stackRect = stack?.getBoundingClientRect();
        const lastCurvePoint = [...(chart?.getDatasetMeta?.(0)?.data || [])]
            .reverse()
            .find((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        const lastCurveX = canvasRect && chart?.width > 0 && lastCurvePoint
            ? canvasRect.left + (lastCurvePoint.x * (canvasRect.width / chart.width))
            : Number.NaN;
        const lineRect = hoverLine?.getBoundingClientRect();
        const horizontalLineRect = horizontalHoverLine?.getBoundingClientRect();
        const fieldRect = probabilityField?.getBoundingClientRect();
        const firstCellRect = firstProbabilityCell?.getBoundingClientRect();
        const scaleY = canvasRect && chart?.height > 0 ? canvasRect.height / chart.height : Number.NaN;
        const curveY = canvasRect && Number.isFinite(bounds?.intersectionY) && Number.isFinite(scaleY)
            ? canvasRect.top + (bounds.intersectionY * scaleY)
            : Number.NaN;
        return {
            activeIndex: Number.isInteger(bounds?.index) ? bounds.index : null,
            expectedIndex,
            lastIndex: lastCurvePoint
                ? (chart?.getDatasetMeta?.(0)?.data || []).length - 1
                : null,
            panTarget: Number(stack?.dataset.probabilityPanTarget || 0),
            pointerToLastCurve: Math.abs(lastCurveX - pointerX),
            pointerToVerticalLine: lineRect
                ? Math.abs((lineRect.left + (lineRect.width / 2)) - pointerX)
                : Number.NaN,
            curveToHorizontalLine: horizontalLineRect && Number.isFinite(curveY)
                ? Math.abs((horizontalLineRect.top + (horizontalLineRect.height / 2)) - curveY)
                : Number.NaN,
            fieldRightOfVerticalLine: firstCellRect && lineRect
                ? firstCellRect.left - lineRect.right
                : Number.NaN,
            fieldAtVerticalLine: fieldRect && lineRect
                ? Math.abs(fieldRect.left - (lineRect.left + (lineRect.width / 2)))
                : Number.NaN,
            linePastLast: lineRect && Number.isFinite(lastCurveX)
                ? (lineRect.left + (lineRect.width / 2)) - lastCurveX
                : Number.NaN,
            stackWidth: stackRect?.width ?? Number.NaN,
        };
    }, {pointerX: leftAnchor.x, expectedIndex: leftAnchor.index});
    expect(leftHoverAlignment.activeIndex).toBe(leftAnchor.index);
    expect(leftHoverAlignment.panTarget).toBeLessThan(leftHoverAlignment.stackWidth * 0.2);
    expect(leftHoverAlignment.pointerToLastCurve).toBeGreaterThan(48);
    expect(leftHoverAlignment.pointerToVerticalLine).toBeLessThanOrEqual(1.5);
    expect(leftHoverAlignment.curveToHorizontalLine).toBeLessThanOrEqual(1.5);
    expect(leftHoverAlignment.linePastLast).toBeLessThanOrEqual(1.5);
    expect(leftHoverAlignment.fieldRightOfVerticalLine).toBeGreaterThanOrEqual(0.5);
    expect(leftHoverAlignment.fieldAtVerticalLine).toBeLessThanOrEqual(1.5);

    // Select the independent right-side anchor from the stationary baseline;
    // tracking must keep the guide beneath screen-space pointer X during pan.
    await movePointerOutsideProbabilitySurface();
    const edgeAnchor = await moveToVisiblePriceCurve(0.8, 'rightward tracking');
    await waitForPanTarget();
    const trackingStart = await panSnapshot();
    const trackingPointerStart = edgeAnchor.x;
    const trackingSamples = [];
    for (let step = 1; step <= 24; step += 1) {
        const pointerX = trackingPointerStart + step;
        await page.mouse.move(pointerX, edgeAnchor.y);
        await page.waitForTimeout(16);
        const snapshot = await panSnapshot();
        const alignment = await page.evaluate(({pointerX: currentPointerX, pointerY: currentPointerY}) => {
            const canvas = document.querySelector('#tradePriceChart');
            const chart = window.Chart?.getChart?.(canvas);
            const hoverLine = document.querySelector('.trade-chart-hover-line');
            const horizontalHoverLine = document.querySelector('.trade-chart-hover-horizontal-line');
            const probabilityField = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
            const firstProbabilityCell = probabilityField?.querySelector('.backtest-probability-cell');
            const bounds = chart?._activeBacktestProbabilityGridBounds;
            const point = Number.isInteger(bounds?.index)
                ? chart?.getDatasetMeta?.(0)?.data?.[bounds.index]
                : null;
            const canvasRect = canvas?.getBoundingClientRect();
            const lineRect = hoverLine?.getBoundingClientRect();
            const horizontalLineRect = horizontalHoverLine?.getBoundingClientRect();
            const probabilityFieldRect = probabilityField?.getBoundingClientRect();
            const firstProbabilityCellRect = firstProbabilityCell?.getBoundingClientRect();
            const curveX = canvasRect && chart?.width > 0 && point
                ? canvasRect.left + (point.x * (canvasRect.width / chart.width))
                : Number.NaN;
            const scaleY = canvasRect && chart?.height > 0 ? canvasRect.height / chart.height : Number.NaN;
            const curveY = canvasRect && Number.isFinite(bounds?.intersectionY) && Number.isFinite(scaleY)
                ? canvasRect.top + (bounds.intersectionY * scaleY)
                : Number.NaN;
            const lineX = lineRect ? lineRect.left + (lineRect.width / 2) : Number.NaN;
            const lastPoint = [...(chart?.getDatasetMeta?.(0)?.data || [])]
                .reverse()
                .find((candidate) => Number.isFinite(candidate?.x) && Number.isFinite(candidate?.y));
            const lastX = canvasRect && chart?.width > 0 && lastPoint
                ? canvasRect.left + (lastPoint.x * (canvasRect.width / chart.width))
                : Number.NaN;
            return {
                curveX,
                lineX,
                lastX,
                linePastLast: Number.isFinite(lastX) ? lineX - lastX : Number.NaN,
                pointerX: currentPointerX,
                pointerToLine: Math.abs(lineX - currentPointerX),
                pointerToCurve: Math.abs(curveX - currentPointerX),
                pointerToHorizontalLine: horizontalLineRect
                    ? Math.abs((horizontalLineRect.top + (horizontalLineRect.height / 2)) - currentPointerY)
                    : Number.NaN,
                curveToHorizontalLine: horizontalLineRect && Number.isFinite(curveY)
                    ? Math.abs((horizontalLineRect.top + (horizontalLineRect.height / 2)) - curveY)
                    : Number.NaN,
                horizontalGuidePastVertical: horizontalLineRect && lineRect
                    ? horizontalLineRect.right - (lineRect.left + (lineRect.width / 2))
                    : Number.NaN,
                fieldRightOfVerticalLine: probabilityFieldRect && lineRect && firstProbabilityCellRect
                    ? firstProbabilityCellRect.left - lineRect.right
                    : Number.NaN,
            };
        }, {pointerX, pointerY: edgeAnchor.y});
        trackingSamples.push({pointerX, snapshot, alignment});
    }
    const trackingEnd = trackingSamples.at(-1)?.snapshot;
    const trackingPointerDistance = trackingSamples.at(-1)?.pointerX - trackingPointerStart;
    const trackingTargetDistance = trackingEnd?.target - trackingStart?.target;
    expect(trackingStart?.target).toBeGreaterThan(0);
    expect(trackingPointerDistance).toBe(24);
    // A rightward pointer step may increase the overflow pan, but the moving
    // canvas must not amplify that step into a jump to the series endpoint.
    expect(Math.abs(trackingTargetDistance)).toBeLessThanOrEqual(trackingPointerDistance + 10);
    expect(Math.max(...trackingSamples.map((sample) => sample.alignment.linePastLast)))
        .toBeLessThanOrEqual(1.5);
    expect(Math.max(...trackingSamples.map((sample) => sample.alignment.curveToHorizontalLine)))
        .toBeLessThanOrEqual(1.5);
    trackingSamples.forEach((sample) => {
        if (sample.alignment.linePastLast <= -2) {
            expect(sample.alignment.pointerToLine).toBeLessThanOrEqual(1.5);
            expect(sample.alignment.pointerToCurve).toBeLessThanOrEqual(1.5);
        }
    });
    expect(Math.min(...trackingSamples.map((sample) => sample.alignment.horizontalGuidePastVertical)))
        .toBeGreaterThanOrEqual(8);
    expect(Math.min(...trackingSamples.map((sample) => sample.alignment.fieldRightOfVerticalLine)))
        .toBeGreaterThanOrEqual(0.5);

    const offCurvePointer = await page.evaluate(({x}) => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const stack = canvas?.closest('.trade-chart-stack');
        const stackRect = stack?.getBoundingClientRect();
        const canvasRect = canvas?.getBoundingClientRect();
        const bounds = chart?._activeBacktestProbabilityGridBounds;
        const scaleY = canvasRect && chart?.height > 0
            ? canvasRect.height / chart.height
            : Number.NaN;
        const curveY = canvasRect && Number.isFinite(bounds?.intersectionY) && Number.isFinite(scaleY)
            ? canvasRect.top + (bounds.intersectionY * scaleY)
            : Number.NaN;
        if (!(stackRect instanceof DOMRect) || !Number.isFinite(curveY)) return null;
        const delta = curveY + 18 <= stackRect.bottom - 12 ? 18 : -18;
        return {x, y: curveY + delta};
    }, {x: trackingSamples.at(-1)?.pointerX});
    expect(offCurvePointer).not.toBeNull();
    await page.mouse.move(offCurvePointer.x, offCurvePointer.y);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    const offCurveAlignment = await page.evaluate(({pointerY}) => {
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const hoverLine = document.querySelector('.trade-chart-hover-line');
        const horizontalHoverLine = document.querySelector('.trade-chart-hover-horizontal-line');
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        if (!(tooltip instanceof HTMLElement)
            || !(hoverLine instanceof HTMLElement)
            || !(horizontalHoverLine instanceof HTMLElement)
            || !cells.length) return null;
        const horizontalLineRect = horizontalHoverLine.getBoundingClientRect();
        const hoverLineRect = hoverLine.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const canvasRect = canvas?.getBoundingClientRect();
        const bounds = chart?._activeBacktestProbabilityGridBounds;
        const scaleY = canvasRect && chart?.height > 0 ? canvasRect.height / chart.height : Number.NaN;
        const curveY = canvasRect && Number.isFinite(bounds?.intersectionY) && Number.isFinite(scaleY)
            ? canvasRect.top + (bounds.intersectionY * scaleY)
            : Number.NaN;
        const lineY = horizontalLineRect.top + (horizontalLineRect.height / 2);
        const upCells = cells.filter((cell) => cell.classList.contains('is-up'));
        const downCells = cells.filter((cell) => cell.classList.contains('is-down'));
        return {
            downViolations: downCells.filter((cell) => (
                cell.getBoundingClientRect().top < lineY - 1.5
            )).length,
            horizontalGuidePastField: horizontalLineRect.right - tooltipRect.right,
            horizontalGuidePastVertical: horizontalLineRect.right
                - (hoverLineRect.left + (hoverLineRect.width / 2)),
            pointerToHorizontalLine: Math.abs(lineY - pointerY),
            curveToHorizontalLine: Number.isFinite(curveY) ? Math.abs(lineY - curveY) : Number.NaN,
            upViolations: upCells.filter((cell) => (
                cell.getBoundingClientRect().bottom > lineY + 1.5
            )).length,
        };
    }, {pointerY: offCurvePointer.y});
    expect(offCurveAlignment).not.toBeNull();
    expect(offCurveAlignment.curveToHorizontalLine).toBeLessThanOrEqual(1.5);
    expect(offCurveAlignment.pointerToHorizontalLine).toBeGreaterThan(8);
    expect(offCurveAlignment.horizontalGuidePastVertical).toBeGreaterThanOrEqual(8);
    expect(offCurveAlignment.horizontalGuidePastField).toBeGreaterThanOrEqual(-0.5);
    expect(offCurveAlignment.upViolations).toBe(0);
    expect(offCurveAlignment.downViolations).toBe(0);

    const curveRightBoundary = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const stack = canvas?.closest('.trade-chart-stack');
        const chart = window.Chart?.getChart?.(canvas);
        const canvasRect = canvas?.getBoundingClientRect();
        const stackRect = stack?.getBoundingClientRect();
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        const lastPoint = [...points].reverse().find((point) => Number.isFinite(point?.x));
        if (!(canvas instanceof HTMLCanvasElement)
            || !(stack instanceof HTMLElement)
            || !chart
            || !canvasRect
            || !stackRect
            || !lastPoint
            || !(Number(chart.width) > 0)
            || !(Number(chart.height) > 0)) return null;
        return {
            curveRight: canvasRect.left + (lastPoint.x * (canvasRect.width / chart.width)),
            stackLeft: stackRect.left,
            stackRight: stackRect.right,
            y: canvasRect.top + (lastPoint.y * (canvasRect.height / chart.height)),
        };
    });
    expect(curveRightBoundary).not.toBeNull();
    const curveRightInside = Math.max(
        curveRightBoundary.curveRight - 2,
        curveRightBoundary.stackLeft + 8,
    );
    await page.mouse.move(curveRightInside, curveRightBoundary.y);
    await expect(probabilityTooltip).toHaveClass(/is-visible/);
    const hoverPastCurveRight = curveRightBoundary.stackRight + 4;
    expect(hoverPastCurveRight).toBeGreaterThan(curveRightBoundary.curveRight);
    await page.mouse.move(hoverPastCurveRight, curveRightBoundary.y);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart?.(document.querySelector('#tradePriceChart'));
        const probabilityField = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const hoverLine = document.querySelector('.trade-chart-hover-line');
        const horizontalHoverLine = document.querySelector('.trade-chart-hover-horizontal-line');
        const hoverDateLabel = document.querySelector('[data-backtest-hover-date-label]');
        return {
            activeIndex: Number.isInteger(chart?._activeBacktestProbabilityGridBounds?.index)
                ? chart._activeBacktestProbabilityGridBounds.index
                : null,
            dateVisible: hoverDateLabel?.classList.contains('is-visible') || false,
            fieldVisible: probabilityField?.classList.contains('is-visible') || false,
            horizontalVisible: horizontalHoverLine?.classList.contains('is-visible') || false,
            verticalVisible: hoverLine?.classList.contains('is-visible') || false,
        };
    })).toEqual({
        activeIndex: null,
        dateVisible: false,
        fieldVisible: false,
        horizontalVisible: false,
        verticalVisible: false,
    });

    await movePointerOutsideProbabilitySurface();
    const resetLeftAnchor = await pointAtIndex(leftAnchor.index);
    if (!resetLeftAnchor) throw new Error('Bayesian reference hover anchor is unavailable after reset.');
    await page.mouse.move(resetLeftAnchor.x, resetLeftAnchor.y);
    await expect.poll(() => page.evaluate(() => (
        Number(document.querySelector('#backtest_probability_detail_panel')?.dataset.activeIndex)
    ))).toBe(leftAnchor.index);

    const boundaryProbePoints = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const rect = canvas?.getBoundingClientRect();
        const chartWidth = Number(chart?.width);
        const chartHeight = Number(chart?.height);
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const predictiveMean = Array.isArray(presentation?.predictive_mean)
            ? presentation.predictive_mean
            : [];
        const predictiveScale = Array.isArray(presentation?.predictive_scale)
            ? presentation.predictive_scale
            : [];
        if (!(canvas instanceof HTMLCanvasElement) || !rect
            || !(chartWidth > 0) || !(chartHeight > 0)) return [];
        const candidates = (chart?.getDatasetMeta?.(0)?.data || [])
            .map((point, index) => ({index, point}))
            .filter(({index, point}) => (
                Number.isFinite(point?.x)
                && Number.isFinite(point?.y)
                && predictiveMean[index] !== null
                && predictiveMean[index] !== undefined
                && predictiveScale[index] !== null
                && predictiveScale[index] !== undefined
            ))
            .sort((left, right) => left.point.y - right.point.y);
        const selected = [
            candidates[0],
            candidates[Math.floor(candidates.length / 3)],
            candidates[Math.floor((candidates.length * 2) / 3)],
            candidates[candidates.length - 1],
        ].filter(Boolean);
        return Array.from(new Map(selected.map(({index, point}) => [index, {
            index,
            x: rect.left + (point.x * (rect.width / chartWidth)),
            y: rect.top + (point.y * (rect.height / chartHeight)),
        }])).values());
    });
    for (const probe of boundaryProbePoints) {
        // Start each probe from a clean pointer baseline. During tracking,
        // chart translation must not be mistaken for pointer movement.
        await movePointerOutsideProbabilitySurface();
        const currentProbe = await hoverExactIndex(probe.index);
        if (!currentProbe) throw new Error(`Bayesian probe ${probe.index} is unavailable.`);
        await page.mouse.move(currentProbe.x, currentProbe.y);
        await expect.poll(() => page.evaluate(() => (
            Number(document.querySelector('#backtest_probability_detail_panel')?.dataset.activeIndex)
        ))).toBe(probe.index);
        await expect(probabilityTooltip).toHaveClass(/is-visible/);
        await expectDetailColorBoundary(
            `Bayesian detail cells must remain color-aligned at hover index ${probe.index}`,
        );
    }
    await movePointerOutsideProbabilitySurface();
    const currentLeftAnchor = await pointAtIndex(leftAnchor.index);
    if (!currentLeftAnchor) throw new Error('Bayesian reference hover anchor is unavailable after panning.');
    await page.mouse.move(currentLeftAnchor.x, currentLeftAnchor.y);
    await expect.poll(() => page.evaluate(() => (
        Number(document.querySelector('#backtest_probability_detail_panel')?.dataset.activeIndex)
    ))).toBe(leftAnchor.index);
    await expectDetailColorBoundary('Returning to the reference hover must preserve the detail boundary');

    const contract = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const equityCanvas = document.querySelector('#tradeEquityChart');
        const chart = window.Chart?.getChart?.(canvas);
        const stack = canvas?.closest('.trade-chart-stack');
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const grid = tooltip?.querySelector('[data-backtest-probability-grid]');
        const cells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        if (!chart || !(canvas instanceof HTMLCanvasElement)
            || !(equityCanvas instanceof HTMLCanvasElement)
            || !(stack instanceof HTMLElement) || !(tooltip instanceof HTMLElement)
            || !(grid instanceof HTMLElement) || !cells.length) {
            return null;
        }
        const bounds = chart._activeBacktestProbabilityGridBounds;
        const guide = chart._activeBacktestPriceGuideBounds;
        if (!bounds || !guide) return null;
        const tooltipRect = tooltip.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const hoverLine = document.querySelector('.trade-chart-hover-line');
        const hoverLineRect = hoverLine?.getBoundingClientRect();
        const verticalLineX = hoverLineRect
            ? hoverLineRect.left + (hoverLineRect.width / 2)
            : Number.NaN;
        const hoverDateLabel = document.querySelector('[data-backtest-hover-date-label]');
        const hoverDateLabelRect = hoverDateLabel?.getBoundingClientRect();
        const hoverDateLabelStyle = hoverDateLabel instanceof HTMLElement
            ? getComputedStyle(hoverDateLabel)
            : null;
        const hoverDateLines = Array.from(
            hoverDateLabel?.querySelectorAll('[data-backtest-hover-date-line]') || [],
        ).map((line) => line.textContent?.trim() || '');
        const rawDate = window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates?.[bounds.index];
        const dateMatch = typeof rawDate === 'string'
            ? /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate)
            : null;
        const dateFormatter = window.WORTHWARD_BOOTSTRAP?.dateDisplay?.formatFullDateLines;
        const expectedHoverDateLines = dateMatch && typeof dateFormatter === 'function'
            ? dateFormatter({
                year: Number(dateMatch[1]),
                monthIndex: Number(dateMatch[2]) - 1,
                day: Number(dateMatch[3]),
            }, {allowWrap: true}).filter(Boolean)
            : [];
        const plotBottom = canvasRect.top + (chart.chartArea.bottom * (canvasRect.height / chart.height));
        const first = cells.find((cell) => cell.dataset.row === '0' && cell.dataset.column === '0');
        const nextColumn = cells.find((cell) => cell.dataset.row === '0' && cell.dataset.column === '1');
        const nextRow = cells.find((cell) => cell.dataset.row === '1' && cell.dataset.column === '0');
        const firstRect = first?.getBoundingClientRect();
        const nextColumnRect = nextColumn?.getBoundingClientRect();
        const nextRowRect = nextRow?.getBoundingClientRect();
        const tooltipStyle = getComputedStyle(tooltip);
        const gridStyle = getComputedStyle(grid);
        const cellStyle = first ? getComputedStyle(first) : null;
        const cellSamples = cells.map((cell) => ({
            displayIntensity: Number(cell.dataset.displayIntensity),
            inlineOpacity: Number(cell.dataset.opacity),
            opacity: Number(getComputedStyle(cell).opacity),
            probability: Number(cell.dataset.probability),
        }));
        const maximumProbability = Math.max(...cellSamples.map((cell) => cell.probability));
        const opacityExponent = Number(tooltip.dataset.cellOpacityExponent);
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = 1;
        colorCanvas.height = 1;
        const colorContext = colorCanvas.getContext('2d', {willReadFrequently: true});
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = tooltipStyle.backgroundColor;
        colorContext.fillRect(0, 0, 1, 1);
        const backgroundAlpha = colorContext.getImageData(0, 0, 1, 1).data[3] / 255;
        const pointSteps = chart.getDatasetMeta(0).data.slice(1).map((point, index) => (
            point.x - chart.getDatasetMeta(0).data[index].x
        )).filter((step) => Number.isFinite(step) && step > 0).sort((left, right) => left - right);
        const midpoint = Math.floor(pointSteps.length / 2);
        const medianStep = pointSteps.length % 2
            ? pointSteps[midpoint]
            : (pointSteps[midpoint - 1] + pointSteps[midpoint]) / 2;
        const horizons = cells.map((cell) => Number(cell.dataset.horizon));
        const panelChildren = Array.from(stack.children).filter((node) => (
            node.classList.contains('trade-chart-panel')
        ));
        const priceXPath = document.evaluate(
            '/html/body/main/div/section/section/div/article[2]/article/article[2]/div[2]/div/div/article/div[2]/div[1]/div/canvas',
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
        ).singleNodeValue;
        const equityXPath = document.evaluate(
            '/html/body/main/div/section/section/div/article[2]/article/article[2]/div[2]/div/div/article/div[2]/div[2]/div/canvas',
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
        ).singleNodeValue;
        return {
            activeIndex: bounds.index,
            availableRowsAbove: bounds.availableRowsAbove,
            availableRowsBelow: bounds.availableRowsBelow,
            availableRowsPerSide: bounds.availableRowsPerSide,
            backdropFilter: tooltipStyle.backdropFilter || 'none',
            backgroundAlpha,
            backgroundImage: tooltipStyle.backgroundImage,
            badgeLeft: guide.badgeLeft,
            badgeRight: guide.badgeRight,
            badgeBottom: guide.badgeBottom,
            badgeTop: guide.badgeTop,
            badgeValue: guide.value,
            borderWidths: [
                tooltipStyle.borderTopWidth,
                tooltipStyle.borderRightWidth,
                tooltipStyle.borderBottomWidth,
                tooltipStyle.borderLeftWidth,
            ],
            boxShadow: tooltipStyle.boxShadow,
            cellBorderRadius: cellStyle?.borderRadius,
            cellBorderWidth: cellStyle?.borderWidth,
            cellTransitionDuration: cellStyle?.transitionDuration,
            cellCount: cells.length,
            cellMinimumSize: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
            cellSquareDelta: Math.max(...cells.map((cell) => {
                const rect = cell.getBoundingClientRect();
                return Math.abs(rect.width - rect.height);
            })),
            centerDelta: Math.abs(
                (tooltipRect.top + (tooltipRect.height / 2)) - (canvasRect.top + guide.y)
            ),
            columns: new Set(cells.map((cell) => cell.dataset.column)).size,
            daysPerColumn: Number(grid.dataset.daysPerColumn),
            direction: bounds.direction,
            opacityMapping: tooltip.dataset.cellOpacityMapping,
            opacityExponent,
            opacityTailRatio: Number(tooltip.dataset.cellOpacityTailRatio),
            cellDisplayThresholdPct: Number(tooltip.dataset.cellDisplayThresholdPct),
            thresholdVisibleCellCount: cells.filter((cell) => (
                cell.dataset.thresholdVisible === 'true'
            )).length,
            thresholdHiddenCellCount: cells.filter((cell) => (
                cell.dataset.thresholdVisible === 'false'
            )).length,
            domXPathStable: priceXPath === canvas && equityXPath === equityCanvas
                && panelChildren.length === 2
                && panelChildren[0].contains(canvas)
                && panelChildren[1].contains(equityCanvas),
            dateLabelBackground: hoverDateLabelStyle?.backgroundColor,
            dateLabelCenterX: hoverDateLabelRect
                ? hoverDateLabelRect.left + (hoverDateLabelRect.width / 2)
                : Number.NaN,
            dateLabelColor: hoverDateLabelStyle?.color,
            dateLabelFontFamily: hoverDateLabelStyle?.fontFamily,
            dateLabelFontSize: hoverDateLabelStyle?.fontSize,
            dateLabelLineHeight: hoverDateLabelStyle?.lineHeight,
            dateLabelRect: hoverDateLabelRect
                ? {
                    bottom: hoverDateLabelRect.bottom,
                    height: hoverDateLabelRect.height,
                    left: hoverDateLabelRect.left,
                    right: hoverDateLabelRect.right,
                    top: hoverDateLabelRect.top,
                    width: hoverDateLabelRect.width,
                }
                : null,
            dateLabelText: hoverDateLines,
            dateLabelTopDelta: hoverDateLabelRect
                ? Math.abs(hoverDateLabelRect.top - plotBottom)
                : Number.NaN,
            dateLabelVisible: hoverDateLabel instanceof HTMLElement
                && !hoverDateLabel.hidden
                && hoverDateLabel.classList.contains('is-visible'),
            expectedHoverDateLines,
            firstCellLeftInset: firstRect ? firstRect.left - tooltipRect.left : null,
            firstCellTopInset: firstRect ? firstRect.top - tooltipRect.top : null,
            guideBottomInset: tooltipRect.bottom - (canvasRect.top + guide.y),
            guideTopInset: (canvasRect.top + guide.y) - tooltipRect.top,
            gridPadding: [
                gridStyle.paddingTop,
                gridStyle.paddingRight,
                gridStyle.paddingBottom,
                gridStyle.paddingLeft,
            ],
            horizonIntegers: horizons.every(Number.isInteger),
            horizonSequence: Array.from(new Set(horizons)).every((horizon, index) => (
                horizon === ((index + 1) * bounds.daysPerColumn)
            )),
            horizontalGap: firstRect && nextColumnRect ? nextColumnRect.left - firstRect.right : null,
            intersectionDelta: Math.abs(bounds.intersectionY - guide.y),
            maximumOpacity: Math.max(...cellSamples.map((cell) => cell.opacity)),
            minimumOpacity: Math.min(...cellSamples.map((cell) => cell.opacity)),
            invisibleCellCount: cellSamples.filter((cell) => cell.opacity === 0).length,
            nonlinearDistance: Math.max(0, ...cellSamples
                .filter((cell) => cell.displayIntensity > 0 && cell.displayIntensity < 1)
                .map((cell) => Math.abs(cell.opacity - cell.displayIntensity))),
            opacityCurveDelta: Math.max(...cellSamples.map((cell) => Math.abs(
                cell.opacity - (cell.displayIntensity > 0
                    ? Math.pow(cell.displayIntensity, opacityExponent)
                    : 0)
            ))),
            opacityInlineDelta: Math.max(...cellSamples.map((cell) => (
                Math.abs(cell.opacity - cell.inlineOpacity)
            ))),
            winnerOpacityDelta: Math.max(...cellSamples
                .filter((cell) => cell.probability === maximumProbability)
                .map((cell) => Math.abs(cell.opacity - 1))),
            minimumCenterOffset: Math.min(...cells.map((cell) => (
                cell.getBoundingClientRect().left
                + (cell.getBoundingClientRect().width / 2)
                - (canvasRect.left + bounds.intersectionX)
            ))),
            opacity: Number(tooltipStyle.opacity),
            rawProbabilityPreserved: cellSamples.every((cell) => (
                Number.isFinite(cell.probability)
                && cell.probability >= 0
                && cell.probability <= 1
            )),
            outerBorderRadius: tooltipStyle.borderRadius,
            rightwardStartDelta: Math.abs(tooltipRect.left - verticalLineX),
            rows: new Set(cells.map((cell) => cell.dataset.row)).size,
            rowsDown: new Set(cells.filter((cell) => cell.classList.contains('is-down'))
                .map((cell) => cell.dataset.row)).size,
            rowsUp: new Set(cells.filter((cell) => cell.classList.contains('is-up'))
                .map((cell) => cell.dataset.row)).size,
            slotLatticeDelta: Math.abs(
                ((bounds.cellSize + bounds.gap) / bounds.stepPixels) - bounds.daysPerColumn
            ),
            slotWidthDelta: firstRect && nextColumnRect
                ? Math.abs((nextColumnRect.left - firstRect.left) - bounds.slotWidth)
                : null,
            stepPixelsDelta: Math.abs(bounds.stepPixels - medianStep),
            tooltipWidth: tooltipRect.width,
            verticalGap: firstRect && nextRowRect ? nextRowRect.top - firstRect.bottom : null,
            verticalLineX,
            webkitBackdropFilter: tooltipStyle.webkitBackdropFilter || 'none',
        };
    });

    expect(contract).not.toBeNull();
    expect(contract.activeIndex).toBe(leftAnchor.index);
    expect(contract.backgroundAlpha).toBe(0);
    expect(contract.opacity).toBe(1);
    expect(contract.backgroundImage).toBe('none');
    expect(contract.borderWidths).toEqual(['0px', '0px', '0px', '0px']);
    expect(contract.boxShadow).toBe('none');
    expect(contract.backdropFilter).toBe('none');
    expect(contract.webkitBackdropFilter).toBe('none');
    expect(contract.outerBorderRadius).toBe('0px');
    expect(contract.cellBorderRadius).toBe('0px');
    expect(contract.cellBorderWidth).toBe('0px');
    expect(contract.cellTransitionDuration).toBe('0s');
    expect(contract.gridPadding[1]).toBe('8px');
    expect(contract.gridPadding[3]).toBe('2px');
    expect(parseFloat(contract.gridPadding[0])).toBeGreaterThanOrEqual(8);
    expect(parseFloat(contract.gridPadding[2])).toBeGreaterThanOrEqual(8);
    expect(contract.firstCellLeftInset).toBeCloseTo(2, 1);
    expect(contract.firstCellTopInset).toBeGreaterThanOrEqual(8);
    expect(contract.cellCount).toBe(contract.rows * contract.columns);
    expect(contract.rows).toBe(contract.rowsUp + contract.rowsDown);
    expect(contract.rowsUp).toBeGreaterThan(0);
    expect(contract.rowsDown).toBeGreaterThanOrEqual(0);
    expect(contract.rowsUp).toBeLessThanOrEqual(10);
    expect(contract.rowsDown).toBeLessThanOrEqual(10);
    expect(contract.rowsUp).toBeLessThanOrEqual(contract.availableRowsPerSide);
    expect(contract.rowsDown).toBeLessThanOrEqual(contract.availableRowsPerSide);
    expect(contract.rowsUp).toBeLessThanOrEqual(contract.availableRowsAbove);
    expect(contract.rowsDown).toBeLessThanOrEqual(contract.availableRowsBelow);
    expect(contract.columns).toBe(20);
    expect(contract.cellMinimumSize).toBeGreaterThanOrEqual(3.99);
    expect(contract.cellSquareDelta).toBeLessThanOrEqual(0.1);
    expect(contract.horizontalGap).toBeGreaterThanOrEqual(0);
    expect(contract.horizontalGap).toBeCloseTo(2, 1);
    expect(Math.abs(contract.horizontalGap - contract.verticalGap)).toBeLessThanOrEqual(0.1);
    expect(Number.isInteger(contract.daysPerColumn)).toBe(true);
    expect(contract.daysPerColumn).toBeGreaterThanOrEqual(1);
    expect(contract.horizonIntegers).toBe(true);
    expect(contract.horizonSequence).toBe(true);
    expect(contract.slotLatticeDelta).toBeLessThanOrEqual(1e-9);
    expect(contract.slotWidthDelta).toBeLessThanOrEqual(0.1);
    expect(contract.stepPixelsDelta).toBeLessThanOrEqual(0.01);
    expect(contract.direction).toBe('right');
    expect(contract.rightwardStartDelta).toBeLessThanOrEqual(0.75);
    expect(contract.minimumCenterOffset).toBeGreaterThan(0);
    expect(contract.centerDelta).toBeGreaterThanOrEqual(0);
    expect(contract.guideTopInset).toBeGreaterThanOrEqual(0);
    expect(contract.guideBottomInset).toBeGreaterThanOrEqual(0);
    expect(contract.intersectionDelta).toBeLessThanOrEqual(1.5);
    expect(contract.opacityMapping).toBe('instant-contrast-power-v1');
    expect(contract.opacityExponent).toBe(1.6);
    expect(contract.opacityTailRatio).toBe(0.02);
    expect(contract.cellDisplayThresholdPct).toBe(0);
    expect(contract.thresholdVisibleCellCount).toBe(contract.cellCount);
    expect(contract.thresholdHiddenCellCount).toBe(0);
    expect(contract.maximumOpacity).toBe(1);
    expect(contract.minimumOpacity).toBeGreaterThan(0);
    expect(contract.invisibleCellCount).toBe(0);
    expect(contract.nonlinearDistance).toBeGreaterThan(1e-4);
    expect(contract.opacityCurveDelta).toBeLessThanOrEqual(1e-6);
    expect(contract.opacityInlineDelta).toBeLessThanOrEqual(1e-6);
    expect(contract.winnerOpacityDelta).toBeLessThanOrEqual(1e-6);
    expect(contract.rawProbabilityPreserved).toBe(true);
    expect(contract.badgeLeft).toBeLessThan(contract.badgeRight);
    expect(contract.badgeTop).toBeLessThanOrEqual(contract.badgeBottom);
    expect(Number.isFinite(contract.badgeValue)).toBe(true);
    expect(contract.dateLabelVisible).toBe(true);
    expect(contract.dateLabelCenterX).toBeCloseTo(contract.verticalLineX, 1);
    expect(contract.dateLabelTopDelta).toBeLessThanOrEqual(1.5);
    expect(contract.dateLabelText).toEqual(contract.expectedHoverDateLines);
    expect(contract.dateLabelText).toEqual([
        expect.stringMatching(/^\d{1,2} [A-Z][a-z]{2}$/),
        expect.stringMatching(/^\d{4}$/),
    ]);
    expect(contract.dateLabelBackground).toBe('rgb(0, 85, 204)');
    expect(contract.dateLabelColor).toBe('rgb(255, 255, 255)');
    expect(contract.dateLabelFontFamily).toMatch(/BlinkMacSystemFont|system-ui/);
    expect(contract.dateLabelFontSize).toBe('12px');
    expect(contract.dateLabelLineHeight).toBe('10px');
    expect(contract.domXPathStable).toBe(true);

    const detailContract = await page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const panel = document.querySelector('#backtest_probability_detail_panel');
        const detailGrid = panel?.querySelector('[data-backtest-probability-detail-grid]');
        const detailCells = Array.from(detailGrid?.querySelectorAll('.backtest-probability-detail-cell') || []);
        const detailAnchor = panel?.querySelector('[data-backtest-probability-detail-anchor]');
        const tooltip = document.querySelector('[data-backtest-chart-tooltip="probability-grid"]');
        const tooltipCells = Array.from(tooltip?.querySelectorAll('.backtest-probability-cell') || []);
        const presentation = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const probabilityGridApi = window.WORTHWARD_BACKTEST_PROBABILITY_GRID;
        const yTicks = Array.from(panel?.querySelectorAll('[data-backtest-probability-detail-y-axis] .backtest-probability-detail-y-tick') || []);
        const xTicks = Array.from(panel?.querySelectorAll('[data-backtest-probability-detail-x-tick]') || []);
        const status = panel?.querySelector('[data-backtest-probability-detail-status]');
        const forecastDateTitle = panel?.querySelector('.backtest-probability-detail-x-axis-title');
        const detailGridRect = detailGrid?.getBoundingClientRect();
        const detailViewportRect = detailGrid?.parentElement?.getBoundingClientRect();
        const detailAnchorRect = detailAnchor?.getBoundingClientRect();
        const detailCellRects = detailCells.map((cell) => cell.getBoundingClientRect());
        const detailGridFitsViewport = Boolean(detailGridRect && detailViewportRect)
            && detailGridRect.left >= detailViewportRect.left - 0.5
            && detailGridRect.right <= detailViewportRect.right + 0.5
            && detailGridRect.top >= detailViewportRect.top - 0.5
            && detailGridRect.bottom <= detailViewportRect.bottom + 0.5;
        const bounds = chart?._activeBacktestProbabilityGridBounds;
        const detailRowsAbove = detailCells.reduce((maximum, cell) => (
            cell.classList.contains('is-up')
                ? Math.max(maximum, Number(cell.dataset.row) + 1)
                : maximum
        ), 0);
        const detailCellByKey = new Map(detailCells.map((cell) => [
            `${cell.dataset.row}:${cell.dataset.column}`,
            cell,
        ]));
        const hoverCellDataMatches = tooltipCells.every((cell) => {
            const hoverRow = Number(cell.dataset.row);
            const detailRow = cell.classList.contains('is-up')
                ? detailRowsAbove - Number(bounds?.rowsAbove || 0) + hoverRow
                : detailRowsAbove + hoverRow - Number(bounds?.rowsAbove || 0);
            const detailCell = detailCellByKey.get(`${detailRow}:${cell.dataset.column}`);
            return detailCell
                && detailCell.dataset.probability === cell.dataset.probability
                && detailCell.dataset.lowerPrice === cell.dataset.lowerPrice
                && detailCell.dataset.upperPrice === cell.dataset.upperPrice;
        });
        const detailUpCells = detailCells.filter((cell) => cell.classList.contains('is-up'));
        const detailDownCells = detailCells.filter((cell) => cell.classList.contains('is-down'));
        const detailColorsStayOnPriceSide = Boolean(detailAnchorRect)
            && detailUpCells.every((cell) => (
                cell.getBoundingClientRect().bottom <= detailAnchorRect.top + 0.51
            ))
            && detailDownCells.every((cell) => (
                cell.getBoundingClientRect().top >= detailAnchorRect.bottom - 0.51
            ));
        const xTickRects = xTicks.map((tick) => tick.getBoundingClientRect());
        const xTicksDoNotOverlap = xTickRects.every((rect, index) => (
            index === 0 || rect.left >= xTickRects[index - 1].right - 0.5
        ));
        const activeIndex = Number(panel?.dataset.activeIndex);
        const dynamicCell = tooltipCells.find((cell) => Number(cell.dataset.horizon) > 1);
        const dynamicExpectedProbability = dynamicCell && probabilityGridApi
            ? probabilityGridApi.probabilityBetweenPrices({
                anchorPrice: Number(window.WORTHWARD_APP?.backtestResult?.chart?.close?.[activeIndex]),
                lowerPrice: Number(dynamicCell.dataset.lowerPrice),
                upperPrice: Number(dynamicCell.dataset.upperPrice),
                mean: Number(presentation?.predictive_mean?.[activeIndex]),
                scale: Number(presentation?.predictive_scale?.[activeIndex]),
                horizon: Number(dynamicCell.dataset.horizon),
                autoregression: Number(presentation?.return_autoregression?.[activeIndex]),
                longRunMean: Number(presentation?.return_long_run_mean?.[activeIndex]),
                innovationScale: Number(presentation?.return_innovation_scale?.[activeIndex]),
            })
            : Number.NaN;
        const firstTick = xTicks[0];
        const rawDates = window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates || [];
        const rawDate = firstTick?.dataset.rawDate;
        const dateMatch = typeof rawDate === 'string'
            ? /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate)
            : null;
        const dateFormatter = window.WORTHWARD_BOOTSTRAP?.dateDisplay?.formatFullDateLines;
        const expectedDateText = dateMatch && typeof dateFormatter === 'function'
            ? dateFormatter({
                year: Number(dateMatch[1]),
                monthIndex: Number(dateMatch[2]) - 1,
                day: Number(dateMatch[3]),
            }, {allowWrap: true}).filter(Boolean).join('')
            : null;
        return {
            activeIndex,
            ariaHidden: panel?.getAttribute('aria-hidden'),
            cellCount: detailCells.length,
            detailCellSizesPositive: detailCellRects.every((rect) => rect.width > 0 && rect.height > 0 && Math.abs(rect.width - rect.height) <= 0.1),
            columns: Number(detailGrid?.dataset.columnCount),
            detailRowsAbove,
            detailGridWidth: detailGridRect?.width ?? Number.NaN,
            detailGridHeight: detailGridRect?.height ?? Number.NaN,
            detailGridFitsViewport,
            detailColorsStayOnPriceSide,
            dynamicProbabilityMatchesState: Boolean(
                dynamicCell
                && Number.isFinite(dynamicExpectedProbability)
                && Math.abs(
                    dynamicExpectedProbability - Number(dynamicCell.dataset.probability),
                ) <= 1e-12,
            ),
            dynamicStateLengths: {
                autoregression: presentation?.return_autoregression?.length || 0,
                longRunMean: presentation?.return_long_run_mean?.length || 0,
                innovationScale: presentation?.return_innovation_scale?.length || 0,
            },
            multiStepKind: presentation?.multi_step_kind || null,
            expectedDateText,
            firstDateText: firstTick?.textContent?.trim() || '',
            gap: detailCellRects[0] && detailCellRects[1]
                ? detailCellRects[1].left - detailCellRects[0].right
                : Number.NaN,
            hoverCellDataMatches,
            detailContractCount: panel?.querySelectorAll('[data-backtest-probability-detail-contract]').length || 0,
            detailLegendCount: panel?.querySelectorAll('.backtest-probability-detail-legend').length || 0,
            panelHidden: panel instanceof HTMLElement ? panel.hidden : true,
            rows: Number(detailGrid?.dataset.rowCount),
            requestedRows: Number(window.WORTHWARD_APP?.backtestResult?.strategy_presentation?.rows_above)
                + Number(window.WORTHWARD_APP?.backtestResult?.strategy_presentation?.rows_below),
            statusText: status?.textContent?.trim() || '',
            forecastDateTitleCount: forecastDateTitle ? 1 : 0,
            xTickCount: xTicks.length,
            xTicksDoNotOverlap,
            yTickCount: yTicks.length,
            yTicksHaveValues: yTicks.every((tick) => Boolean(tick.textContent?.trim())),
        };
    });
    expect(detailContract).not.toBeNull();
    expect(detailContract.panelHidden).toBe(false);
    expect(detailContract.ariaHidden).toBe('false');
    expect(detailContract.activeIndex).toBe(leftAnchor.index);
    expect(detailContract.cellCount).toBe(detailContract.rows * detailContract.columns);
    expect(detailContract.detailGridFitsViewport).toBe(true);
    expect(detailContract.hoverCellDataMatches).toBe(true);
    expect(detailContract.detailColorsStayOnPriceSide).toBe(true);
    expect(detailContract.multiStepKind).toBe('causal-ar1-return-state');
    expect(detailContract.dynamicStateLengths.autoregression).toBe(80);
    expect(detailContract.dynamicStateLengths.longRunMean).toBe(80);
    expect(detailContract.dynamicStateLengths.innovationScale).toBe(80);
    expect(detailContract.dynamicProbabilityMatchesState).toBe(true);
    expect(detailContract.detailContractCount).toBe(0);
    expect(detailContract.detailLegendCount).toBe(0);
    expect(detailContract.statusText).toMatch(/^Selected date: \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(detailContract.forecastDateTitleCount).toBe(0);
    expect(detailContract.columns).toBe(20);
    expect(detailContract.rows).toBe(detailContract.requestedRows);
    expect(detailContract.detailRowsAbove).toBe(10);
    expect(detailContract.detailCellSizesPositive).toBe(true);
    expect(detailContract.gap).toBeCloseTo(2, 1);
    expect(detailContract.xTickCount).toBeGreaterThanOrEqual(1);
    expect(detailContract.xTickCount).toBeLessThanOrEqual(9);
    expect(detailContract.xTicksDoNotOverlap).toBe(true);
    expect(detailContract.yTickCount).toBe(5);
    expect(detailContract.yTicksHaveValues).toBe(true);
    if (detailContract.expectedDateText) {
        expect(detailContract.firstDateText).toContain(detailContract.expectedDateText);
    }


    return {
        baselineGeometry,
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
    };
}
