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
test('syncs the overview donut to the hovered 1W and 1M valuation point', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
        '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26',
        '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03',
        '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
        '2026-07-13', '2026-07-14', '2026-07-15',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 20, price: 100, amount: -2000},
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'SPY', currency: 'USD', quantity: 20, price: 100, amount: -2000},
        ],
        tradingDays,
        intradayRows: (url) => {
            const ticker = String(url.searchParams.get('ticker') || '');
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day, dayIndex) => Array.from({length: 390}, (_, minuteOffset) => {
                const totalMinutes = (9 * 60) + 30 + minuteOffset;
                const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                const minutes = String(totalMinutes % 60).padStart(2, '0');
                const close = ticker === 'QQQ'
                    ? 100 + (dayIndex * 8) + (minuteOffset * 0.5)
                    : 300 - (dayIndex * 4) - (minuteOffset * 0.4);
                return {date: `${day} ${hours}:${minutes}`, open: close, high: close, low: close, close};
            }));
        },
    });
    await page.setViewportSize({width: 919, height: 1_090});
    await page.goto('/trade/investment');

    const moveToChartPoint = async (index) => {
        const point = await page.evaluate((pointIndex) => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const element = chart?.getDatasetMeta(0)?.data?.[pointIndex];
            if (!canvas || !element) return null;
            const center = element.getCenterPoint();
            const rect = canvas.getBoundingClientRect();
            return {x: rect.left + center.x, y: rect.top + center.y};
        }, index);
        expect(point).not.toBeNull();
        await page.mouse.move(point.x, point.y);
        await expect.poll(() => page.locator(
            '[data-investment-chart-tooltip="1"] .chart-tooltip-label',
        ).evaluateAll((labels) => labels.slice(-3).map((label) => label.textContent))).toEqual([
            'Realized P&L',
            'Unrealized P&L',
            'Cumulative P&L',
        ]);
        await expect(page.locator(
            '[data-investment-chart-tooltip="1"] .chart-tooltip-label',
        ).filter({hasText: /^P&L$/})).toHaveCount(0);
        return expect.poll(() => page.locator('#investment_dummy_donut').evaluate((donut) => (
            donut.style.getPropertyValue('--portfolio-donut-fill')
        ))).not.toBe('');
    };

    for (const [range, dayCount] of [['1w', 5], ['1m', 23]]) {
        await page.locator(`label[for="investment_equity_range_${range}"]`).click();
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.datasets?.[0]?.data
                ?.filter(Number.isFinite).length || 0
        )), {timeout: 30_000}).toBe(dayCount * 390);
        await moveToChartPoint(0);
        const openingFill = await page.locator('#investment_dummy_donut').evaluate((donut) => (
            donut.style.getPropertyValue('--portfolio-donut-fill')
        ));
        await moveToChartPoint((dayCount * 390) - 1);
        await expect.poll(() => page.locator('#investment_dummy_donut').evaluate((donut) => (
            donut.style.getPropertyValue('--portfolio-donut-fill')
        ))).not.toBe(openingFill);
    }
});

test('shows hovered total equity in the shared blue y-axis badge across every Overview range', async ({page}) => {
    const dailyHistory = Array.from({length: 590}, (_, index) => {
        const date = new Date(Date.UTC(2025, 0, 1 + index));
        return {
            date: date.toISOString().slice(0, 10),
            close: 100 + (index * 0.1),
        };
    });
    const tradingDays = Array.from({length: 23}, (_, index) => {
        const date = new Date(Date.UTC(2026, 6, 13 + index));
        return date.toISOString().slice(0, 10);
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2025-01-02', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1_000},
        ],
        tradingDays,
        priceHistoryByTicker: {QQQ: dailyHistory},
        intradayRows: (url) => String(url.searchParams.get('days') || '')
            .split(',')
            .filter(Boolean)
            .flatMap((day, dayIndex) => [
                {date: `${day} 09:30`, open: 150 + dayIndex, high: 150 + dayIndex, low: 150 + dayIndex, close: 150 + dayIndex},
                {date: `${day} 15:59`, open: 151 + dayIndex, high: 151 + dayIndex, low: 151 + dayIndex, close: 151 + dayIndex},
            ]),
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=overview&range=1m');

    for (const range of ['1w', '1m', '3m', 'ytd', '1y', 'max']) {
        await page.locator(`label[for="investment_equity_range_${range}"]`).click();
        await expect(page.locator(`#investment_equity_range_${range}`)).toBeChecked();
        await expect.poll(() => page.evaluate(() => (
            window.Chart?.getChart(document.querySelector('#investmentEquityChart'))
                ?.data?.datasets?.[0]?.data?.filter(Number.isFinite).length || 0
        )), {timeout: 30_000}).toBeGreaterThan(0);

        const badge = await page.evaluate(() => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const dataset = chart?.data?.datasets?.[0]?.data || [];
            const finiteIndexes = dataset
                .map((value, index) => Number.isFinite(value) ? index : -1)
                .filter((index) => index >= 0);
            const index = finiteIndexes[Math.floor(finiteIndexes.length / 2)];
            const point = chart?.getDatasetMeta(0)?.data?.[index];
            if (!canvas || !chart || !Number.isInteger(index) || !point) return null;
            const center = point.getCenterPoint();
            chart.setActiveElements([{datasetIndex: 0, index}]);
            chart.tooltip?.setActiveElements(
                [{datasetIndex: 0, index}],
                {x: center.x, y: center.y},
            );
            chart.update('none');
            const bounds = chart._activeInvestmentEquityGuideBounds;
            const horizontalGuide = chart._activeInvestmentEquityHorizontalGuideBounds;
            const equity = Number(dataset[index]);
            if (!bounds || !horizontalGuide || !Number.isFinite(equity)) return null;
            return {
                allocationBadgeRadius: getComputedStyle(canvas)
                    .getPropertyValue('--investment-holdings-allocation-badge-radius').trim(),
                badgeCoversAxis: bounds.badgeLeft < chart.chartArea.left
                    && bounds.badgeRight > chart.chartArea.left - 4,
                badgeWithinCanvas: bounds.badgeLeft >= 0 && bounds.badgeRight <= canvas.clientWidth,
                equityDelta: Math.abs(bounds.equity - equity),
                formattedEquity: bounds.formattedEquity,
                expectedFormattedEquity: new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }).format(equity),
                horizontalGuideSpansPlot: horizontalGuide.left === chart.chartArea.left
                    && horizontalGuide.right === chart.chartArea.right,
                horizontalGuideYDelta: Math.abs(
                    horizontalGuide.y - chart.scales.y.getPixelForValue(equity),
                ),
                yDelta: Math.abs(bounds.y - chart.scales.y.getPixelForValue(equity)),
                yWithinPlot: bounds.y >= chart.chartArea.top && bounds.y <= chart.chartArea.bottom,
            };
        });
        expect(badge).toEqual({
            allocationBadgeRadius: '2px',
            badgeCoversAxis: true,
            badgeWithinCanvas: true,
            equityDelta: 0,
            formattedEquity: badge?.expectedFormattedEquity,
            expectedFormattedEquity: badge?.expectedFormattedEquity,
            horizontalGuideSpansPlot: true,
            horizontalGuideYDelta: 0,
            yDelta: 0,
            yWithinPlot: true,
        });
    }
});

test('reuses Frosted Glass Overview Tooltip DOM on one valuation point', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 100, amount: -100},
        ],
        priceHistoryByTicker: {
            QQQ: [{date: '2026-06-01', close: 100}],
        },
    });
    await page.goto('/trade/investment');
    const readPoint = () => page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const element = chart?.getDatasetMeta(0)?.data?.[0];
        if (!canvas || !element) return null;
        const center = element.getCenterPoint();
        const rect = canvas.getBoundingClientRect();
        return {x: rect.left + center.x, y: rect.top + center.y};
    });
    await expect.poll(readPoint).not.toBeNull();
    const point = await readPoint();

    await page.mouse.move(point.x, point.y);
    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    await expect(tooltip).toHaveClass(/is-visible/);
    const hoverLine = page.locator('#investment_equity_chart [data-investment-equity-hover-line]');
    const hoverDateLabel = page.locator('#investment_equity_chart [data-investment-equity-hover-date-label]');
    await expect(hoverLine).toHaveClass(/is-visible/);
    await expect(hoverDateLabel).toHaveClass(/is-visible/);
    await expect(hoverDateLabel.locator('[data-investment-hover-date-line="primary"]')).toHaveText('1 Jun');
    await expect(hoverDateLabel.locator('[data-investment-hover-date-line="secondary"]')).toHaveText('2026');
    const expectedFontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    await expect.poll(() => hoverDateLabel.evaluate((element) => {
        const style = getComputedStyle(element);
        const axis = window.Chart?.getChart(document.querySelector('#investmentEquityChart'))
            ?.options?.plugins?.investmentXAxisLabels || {};
        return {
            axisFontFamily: axis.fontFamily,
            axisFontSize: `${axis.fontSize}px`,
            axisFontWeight: String(axis.fontWeight),
            axisLineHeight: `${axis.lineHeight}px`,
            backgroundColor: style.backgroundColor,
            color: style.color,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            minWidth: style.minWidth,
            textAlign: style.textAlign,
        };
    })).toMatchObject({
        axisFontFamily: expectedFontFamily,
        axisFontSize: '12px',
        axisFontWeight: '400',
        axisLineHeight: '10px',
        backgroundColor: 'rgb(0, 85, 204)',
        color: 'rgb(255, 255, 255)',
        fontFamily: expectedFontFamily,
        fontSize: '12px',
        fontWeight: '400',
        lineHeight: '10px',
        minWidth: '42px',
        textAlign: 'center',
    });

    await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        if (!chart) return;
        const originalUpdate = chart.update.bind(chart);
        const originalDraw = chart.draw.bind(chart);
        const calls = {draw: 0, update: 0};
        chart.update = (...args) => {
            calls.update += 1;
            return originalUpdate(...args);
        };
        chart.draw = (...args) => {
            calls.draw += 1;
            return originalDraw(...args);
        };
        window.__investmentSamePointHoverCalls = () => ({...calls});
        window.__restoreInvestmentSamePointHoverCalls = () => {
            chart.update = originalUpdate;
            chart.draw = originalDraw;
        };
    });
    for (const offset of [1, 2, 3]) {
        await page.mouse.move(point.x + offset, point.y);
    }
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__investmentSamePointHoverCalls?.())).toEqual({
        draw: 0,
        update: 0,
    });
    await page.evaluate(() => window.__restoreInvestmentSamePointHoverCalls?.());
    expect(await tooltip.locator('.chart-tooltip-label').evaluateAll((labels) => (
        labels.slice(-3).map((label) => label.textContent)
    ))).toEqual([
        'Realized P&L',
        'Unrealized P&L',
        'Cumulative P&L',
    ]);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^P&L$/})).toHaveCount(0);
    await expect.poll(() => tooltip.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            transform: style.transform,
            willChange: style.willChange,
        };
    })).toMatchObject({
        backdropFilter: expect.stringContaining('blur'),
        transform: expect.not.stringMatching(/^none$/),
        willChange: expect.stringContaining('transform'),
    });

    await page.evaluate(() => {
        const list = document.querySelector('[data-investment-chart-tooltip="1"] .chart-tooltip-list');
        let mutationCount = 0;
        const observer = new MutationObserver((records) => {
            mutationCount += records.length;
        });
        observer.observe(list, {childList: true});
        window.__investmentTooltipMutationCount = () => mutationCount;
    });
    for (const offset of [-3, -1, 1, 3]) {
        await page.mouse.move(point.x + offset, point.y);
    }
    await page.waitForTimeout(100);
    await expect.poll(() => page.evaluate(() => (
        window.__investmentTooltipMutationCount?.() || 0
    ))).toBeLessThan(2);

    await page.mouse.move(0, 0);
    await expect(hoverLine).not.toHaveClass(/is-visible/);
    await expect(hoverDateLabel).not.toHaveClass(/is-visible/);
    await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        if (!chart) return;
        const originalUpdate = chart.update.bind(chart);
        const originalDraw = chart.draw.bind(chart);
        const calls = {draw: 0, update: 0};
        chart.update = (...args) => {
            calls.update += 1;
            return originalUpdate(...args);
        };
        chart.draw = (...args) => {
            calls.draw += 1;
            return originalDraw(...args);
        };
        window.__investmentHoverChartCalls = () => ({...calls});
    });
    await page.locator('#investment_history tr[data-investment-history-row]').first().hover();
    await expect.poll(() => page.evaluate(() => (
        window.__investmentHoverChartCalls?.() || {draw: 0, update: 0}
    ))).toMatchObject({
        draw: expect.any(Number),
        update: 0,
    });
    await expect.poll(() => page.evaluate(() => (
        window.__investmentHoverChartCalls?.().draw || 0
    ))).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (
        window.__investmentHoverChartCalls?.().draw || 0
    ))).toBeLessThanOrEqual(2);
    await expect.poll(() => page.locator(
        '#investment_history tr[data-investment-history-row].is-metric-hover-target',
    ).first().evaluate((row) => getComputedStyle(row).animationName)).toBe('none');

    for (const range of ['3m', 'ytd', '1y', 'max']) {
        await page.locator(`label[for="investment_equity_range_${range}"]`).click();
        const readLastPoint = () => page.evaluate(() => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const elements = chart?.getDatasetMeta(0)?.data || [];
            const element = elements[elements.length - 1];
            if (!canvas || !element) return null;
            const center = element.getCenterPoint();
            const rect = canvas.getBoundingClientRect();
            return {x: rect.left + center.x, y: rect.top + center.y};
        });
        await expect.poll(readLastPoint).not.toBeNull();
        const lastPoint = await readLastPoint();
        await page.mouse.move(lastPoint.x, lastPoint.y);
        await expect.poll(() => tooltip.locator('.chart-tooltip-label').evaluateAll((labels) => (
            labels.slice(-3).map((label) => label.textContent)
        ))).toEqual([
            'Realized P&L',
            'Unrealized P&L',
            'Cumulative P&L',
        ]);
    }
});

test('keeps verified unrealized tooltip P&L when a closed ticker lacks realized coverage', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-05-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1000},
            {broker: 'ibkr', date: '2026-05-01', type: 'buy', ticker: 'OLD', currency: 'USD', quantity: 1, price: 10, amount: -10},
            {broker: 'ibkr', date: '2026-06-01', type: 'sell', ticker: 'OLD', currency: 'USD', quantity: 1, price: 12, amount: 12},
        ],
        summary: {security_transfer_reconciliation: {pnl_unavailable_tickers: ['OLD'], pnl_unavailable_reason: 'cost_basis_unverified'}},
        priceHistoryByTicker: {
            QQQ: [{date: '2026-05-01', close: 100}, {date: '2026-06-01', close: 120}, {date: '2026-08-01', close: 130}],
            OLD: [{date: '2026-05-01', close: 10}, {date: '2026-06-01', close: 12}],
        },
    });
    await page.goto('/trade/investment?view=overview&range=max');
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return chart?.data.labels.findIndex((date) => String(date).startsWith('2026-06-01')) ?? -1;
    })).toBeGreaterThanOrEqual(0);
    await page.evaluate(() => {
        const chart = window.Chart.getChart(document.querySelector('#investmentEquityChart'));
        const index = chart.data.labels.findIndex((date) => String(date).startsWith('2026-06-01'));
        const point = chart.getDatasetMeta(0).data[index];
        chart.setActiveElements([{datasetIndex: 0, index}]);
        chart.tooltip.setActiveElements([{datasetIndex: 0, index}], {x: point.x, y: point.y});
        chart.update('none');
    });
    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    await expect(tooltip).toHaveAttribute('data-investment-pnl-state', 'ready');
    await expect(tooltip.locator('[data-investment-tooltip-pnl="realizedPnl"] .chart-tooltip-value')).toHaveText('Unavailable');
    await expect(tooltip.locator('[data-investment-tooltip-pnl="unrealizedPnl"] .chart-tooltip-value')).toHaveText('200.00');
    await expect(tooltip.locator('[data-investment-tooltip-pnl="cumulativePnl"] .chart-tooltip-value')).toHaveText('Unavailable');
    await expect(page.locator('.investment-report-card').first()).toHaveCSS('padding-bottom', '0px');
});

test('keeps current broker snapshots out of historical Overview hover P&L', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-05-01',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 10,
                price: 100,
                amount: -1_000,
            },
            {
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-07-01',
                type: 'sell',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 5,
                price: 120,
                amount: 600,
            },
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-05-01', close: 100},
                {date: '2026-06-01', close: 110},
                {date: '2026-07-01', close: 120},
                {date: '2026-08-01', close: 150},
            ],
        },
        brokerSummaries: {
            ibkr: {
                broker: 'ibkr',
                account_id: 'IBKR-TEST',
                performance_snapshot_authoritative: true,
                performance_snapshot_as_of: '2026-08-01',
                performance_snapshot: {
                    QQQ: {currency: 'USD', realized_total: '999'},
                },
                position_snapshot_authoritative: true,
                position_snapshot_as_of: '2026-08-01',
                position_snapshot: {
                    QQQ: {
                        quantity: '5',
                        cost_basis_status: 'known',
                        cost_price: '80',
                        market_value: '750',
                        last_price: '150',
                    },
                },
            },
        },
    });
    await page.goto('/trade/investment?view=overview&range=max');
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return chart?.data.labels.findIndex((date) => String(date).startsWith('2026-06-01')) ?? -1;
    })).toBeGreaterThanOrEqual(0);
    await page.evaluate(() => {
        const chart = window.Chart.getChart(document.querySelector('#investmentEquityChart'));
        const index = chart.data.labels.findIndex((date) => String(date).startsWith('2026-06-01'));
        const point = chart.getDatasetMeta(0).data[index];
        chart.setActiveElements([{datasetIndex: 0, index}]);
        chart.tooltip.setActiveElements([{datasetIndex: 0, index}], {x: point.x, y: point.y});
        chart.update('none');
    });

    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    await expect(tooltip).toHaveAttribute('data-investment-pnl-state', 'ready');
    await expect(
        tooltip.locator('[data-investment-tooltip-pnl="realizedPnl"] .chart-tooltip-value'),
    ).toHaveText('0.00');
    await expect(
        tooltip.locator('[data-investment-tooltip-pnl="unrealizedPnl"] .chart-tooltip-value'),
    ).toHaveText('100.00');
    await expect(
        tooltip.locator('[data-investment-tooltip-pnl="cumulativePnl"] .chart-tooltip-value'),
    ).toHaveText('100.00');
});

test('defers uncached 3M historical P&L replay until chart pointer movement settles', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-05-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1_000},
            {broker: 'ibkr', date: '2026-06-01', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 2, price: 120, amount: 240},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-05-01', close: 105},
                {date: '2026-06-01', close: 120},
                {date: '2026-07-01', close: 130},
                {date: '2026-08-01', close: 140},
            ],
        },
    });
    await page.goto('/trade/investment?view=overview&range=3m');
    await expect(page.locator('#investment_equity_range_3m')).toBeChecked();
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))
            ?.getDatasetMeta(0)?.data?.length || 0
    ))).toBeGreaterThan(1);

    const initialState = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const element = chart?.getDatasetMeta(0)?.data?.[0];
        if (!chart || !element) return null;
        const nativeSetTimeout = window.setTimeout.bind(window);
        let pendingPnlCallback = null;
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 48 && typeof callback === 'function') {
                pendingPnlCallback = () => callback(...args);
                return 9_000_001;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
        window.__runPendingInvestmentPnl = () => {
            window.setTimeout = nativeSetTimeout;
            pendingPnlCallback?.();
        };
        const center = element.getCenterPoint();
        chart.setActiveElements([{datasetIndex: 0, index: 0}]);
        chart.tooltip?.setActiveElements(
            [{datasetIndex: 0, index: 0}],
            {x: center.x, y: center.y},
        );
        chart.update('none');
        const tooltip = document.querySelector('[data-investment-chart-tooltip="1"]');
        return {
            pnlState: tooltip?.dataset.investmentPnlState || '',
            pnlValues: Array.from(tooltip?.querySelectorAll(
                '[data-investment-tooltip-pnl] .chart-tooltip-value',
            ) || []).map((value) => value.textContent),
            hasPendingCallback: typeof pendingPnlCallback === 'function',
        };
    });
    expect(initialState).toEqual({
        pnlState: 'pending',
        pnlValues: ['--', '--', '--'],
        hasPendingCallback: true,
    });

    await page.evaluate(() => window.__runPendingInvestmentPnl?.());
    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    await expect(tooltip).toHaveAttribute('data-investment-pnl-state', 'ready');
    const pnlValues = await tooltip.locator('[data-investment-tooltip-pnl] .chart-tooltip-value')
        .evaluateAll((values) => values.map((value) => Number(
            String(value.textContent || '').replace(/[^0-9.-]/g, ''),
        )));
    expect(pnlValues[2]).toBe(Number((pnlValues[0] + pnlValues[1]).toFixed(2)));
});

test('filters stock-details rows by currency, one day, or one calendar month while retaining closed-broker metrics', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-20T12:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    const transactions = [
        {ledger_no: 1, broker: 'hsbc', date: '2026-07-10', type: 'buy', ticker: 'GOOGL', currency: 'HKD', quantity: 1, price: 340, amount: -340, commission: 0.11},
        {ledger_no: 2, broker: 'longbridge_hk', date: '2026-07-10', type: 'buy', ticker: 'GOOGL', currency: 'CNH', quantity: 1, price: 341, amount: -341, commission: 0.12},
        {ledger_no: 3, broker: 'hsbc', date: '2026-07-11', type: 'sell', ticker: 'GOOGL', currency: 'HKD', quantity: 1, price: 342, amount: 342, commission: 0.13},
        {ledger_no: 4, broker: 'longbridge_hk', date: '2026-07-11', type: 'sell', ticker: 'GOOGL', currency: 'CNH', quantity: 1, price: 343, amount: 343, commission: 0.14},
        {ledger_no: 5, broker: 'ibkr', date: '2026-07-12', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 344, amount: -344, commission: 0.15},
        {ledger_no: 6, broker: 'ibkr', date: '2026-08-01', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 345, amount: -345, commission: 0.16},
    ];
    await mockInvestmentReadApis(page, {
        transactions,
        brokers: ['ibkr', 'hsbc', 'longbridge_hk'],
        priceHistoryByTicker: {
            GOOGL: [
                {date: '2026-07-10', close: 340},
                {date: '2026-07-11', close: 343},
                {date: '2026-07-12', close: 344},
                {date: '2026-08-01', close: 345},
            ],
        },
    });
    await page.setViewportSize({width: 920, height: 720});
    await page.goto('/trade/investment?ticker=GOOGL#stock_panel');

    const stockTable = page.locator('#investment_stock_details_table_host');
    const detailRows = stockTable.locator('tr[data-investment-stock-detail-ledger]');
    await expect(detailRows).toHaveCount(6);

    const totalTradesCard = page.locator('.investment-stock-details-metric-card').filter({hasText: 'Total trades'});
    await expect(totalTradesCard).toContainText('HSBC');
    await expect(totalTradesCard).toContainText('Longbridge (HK)');
    const totalCommissionCard = page.locator('.investment-stock-details-metric-card').filter({hasText: 'Total commission'});
    await expect(totalCommissionCard).toContainText('HSBC');
    await expect(totalCommissionCard).toContainText('Longbridge (HK)');

    const currencyHeader = stockTable.locator('th[aria-label="Currency"]');
    await currencyHeader.hover();
    await currencyHeader.getByRole('button', {name: 'Currency filter: All'}).click();
    const currencyOptions = page.locator('[data-investment-currency-filter-dropdown] [data-investment-currency-filter-option]');
    await expect(currencyOptions).toHaveText(['All', 'CNH', 'HKD', 'USD']);
    await page.getByRole('option', {name: 'HKD'}).click();
    await expect(detailRows).toHaveCount(2);
    await expect(detailRows.locator('td:nth-child(6)')).toHaveText(['HKD', 'HKD']);

    await currencyHeader.hover();
    await currencyHeader.getByRole('button', {name: 'Currency filter: HKD'}).click();
    await page.getByRole('option', {name: 'All'}).click();
    await expect(detailRows).toHaveCount(6);

    const timeHeader = stockTable.locator('th[aria-label="Time"]');
    await timeHeader.hover();
    const timeFilterTrigger = timeHeader.getByRole('button', {name: 'Time filter: All dates'});
    await timeFilterTrigger.click();
    const datePanel = page.getByRole('dialog', {name: 'Transaction date filter'});
    await expect(datePanel.getByText('Start date', {exact: true})).toHaveCount(0);
    await expect(datePanel.getByText('End date', {exact: true})).toHaveCount(0);
    await expect(datePanel.getByText('Transaction date', {exact: true})).toHaveCount(0);
    await expect(datePanel.getByRole('textbox', {name: 'Transaction date'})).toHaveCount(1);
    const datePopover = page.locator('[data-date-popover]:not([hidden])');
    await expect(datePopover).toBeVisible();
    await expect.poll(() => timeFilterTrigger.evaluate((trigger) => {
        const rect = trigger.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(
            rect.left + (rect.width / 2),
            rect.top + (rect.height / 2),
        );
        return hitTarget === trigger || trigger.contains(hitTarget);
    })).toBe(true);
    await timeFilterTrigger.click();
    await expect(datePanel).toBeHidden();
    await timeFilterTrigger.click();
    await expect(datePopover).toBeVisible();
    const feedback = page.locator('#investment_stock_details_date_start_feedback');
    await expect(feedback).toHaveText(
        'Choose a day, or select July 2026 for a whole month.',
    );
    const readDatePickerFrame = () => datePopover.evaluate((popover) => {
        const readRect = (element) => {
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
        const feedbackElement = popover.querySelector('[data-date-feedback]');
        const title = popover.querySelector('[data-date-title]');
        const previous = popover.querySelector('[data-date-nav="-1"]');
        const next = popover.querySelector('[data-date-nav="1"]');
        const feedbackStyle = getComputedStyle(feedbackElement);
        const popoverStyle = getComputedStyle(popover);
        return {
            backdropFilter: popoverStyle.backdropFilter,
            backgroundColor: popoverStyle.backgroundColor,
            feedbackColor: feedbackStyle.color,
            feedbackFontSize: feedbackStyle.fontSize,
            frame: readRect(popover),
            guidance: readRect(feedbackElement),
            next: readRect(next),
            previous: readRect(previous),
            title: readRect(title),
            titleColor: getComputedStyle(title).color,
            uiSmallFontSize: getComputedStyle(document.documentElement).getPropertyValue('--font-ui-sm').trim(),
        };
    });
    await page.waitForTimeout(300);
    const dayViewFrame = await readDatePickerFrame();
    expect(dayViewFrame.feedbackColor).toBe(dayViewFrame.titleColor);
    expect(dayViewFrame.feedbackFontSize).toBe(dayViewFrame.uiSmallFontSize);
    expect(dayViewFrame.backgroundColor).toMatch(/^rgb\(/);
    expect(dayViewFrame.backdropFilter).toBe('none');

    await page.locator('[data-date-popover]:not([hidden]) .date-picker-day[data-value="2026-07-10"]').click();
    await expect(datePopover).toBeVisible();
    await expect(detailRows).toHaveCount(2);
    await expect(timeHeader.getByRole('button', {name: 'Time filter: 10 Jul 2026'})).toBeVisible();
    await expect(feedback).toHaveText(
        '10 Jul 2026 selected. Choose another day, or select July 2026 for a whole month.',
    );

    await datePopover.locator('[data-date-title]').click();
    const monthGrid = datePopover.locator('[data-date-month-grid]:not([hidden])');
    await expect(monthGrid).toBeVisible();
    await expect(feedback).toHaveText('Choose a calendar month in 2026.');
    await page.waitForTimeout(300);
    const monthViewFrame = await readDatePickerFrame();
    for (const region of ['frame', 'guidance', 'previous', 'title', 'next']) {
        for (const edge of ['bottom', 'height', 'left', 'right', 'top', 'width']) {
            expect(
                Math.abs(monthViewFrame[region][edge] - dayViewFrame[region][edge]),
                `${region}.${edge} should remain stable between day and month views`,
            ).toBeLessThanOrEqual(0.5);
        }
    }
    await monthGrid.locator('[data-month-value="2026-07"]').click();
    await expect(datePopover).toBeVisible();
    await expect(monthGrid.locator('[data-month-value="2026-07"]')).toHaveClass(/is-selected/);
    await expect(detailRows).toHaveCount(5);
    await expect(timeHeader.getByRole('button', {name: 'Time filter: Jul 2026'})).toBeVisible();
    await expect(feedback).toHaveText('July 2026 selected. Choose another calendar month.');

    await page.getByRole('button', {name: 'Clear date filter'}).click();
    await expect(detailRows).toHaveCount(6);
});

test('leaves an average-price chart gap while a split-adjusted historical position is closed', async ({page}) => {
    const transactions = [
        // The price history is split-adjusted 20:1, while the imported 2023 buy is not.
        {ledger_no: 1, broker: 'ibkr', date: '2023-01-03', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 2000, amount: -2000},
        {ledger_no: 2, broker: 'ibkr', date: '2023-02-03', type: 'sell', ticker: 'GOOGL', currency: 'USD', quantity: 20, price: 100, amount: 2000},
        // This unrelated transaction keeps the intermediate market-history date within the shared chart range.
        {ledger_no: 3, broker: 'ibkr', date: '2024-01-03', type: 'buy', ticker: 'MSFT', currency: 'USD', quantity: 1, price: 100, amount: -100},
        {ledger_no: 4, broker: 'ibkr', date: '2026-07-12', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 344, amount: -344},
    ];
    await mockInvestmentReadApis(page, {
        transactions,
        priceHistoryByTicker: {
            GOOGL: [
                {date: '2023-01-03', close: 100},
                {date: '2023-02-03', close: 100},
                {date: '2024-01-03', close: 100},
                {date: '2026-07-12', close: 344},
            ],
        },
    });
    await page.setViewportSize({width: 920, height: 900});
    await page.goto('/trade/investment?ticker=GOOGL#stock_panel');
    await page.locator('label[for="investment_stock_details_range_max"]').click();

    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('.investment-stock-details-price-chart-canvas');
        const chart = window.Chart?.getChart?.(canvas);
        const labels = chart?.data?.labels || [];
        const averagePrices = chart?.data?.datasets?.[1]?.data || [];
        const closedGapIndex = labels.indexOf('2024-01-03');
        return closedGapIndex >= 0 ? averagePrices[closedGapIndex] : undefined;
    })).toBeNull();
});

for (const viewportWidth of [1_024, 820, 646, 390]) {
test(`draws the exact-price horizontal hover guide across every stock-details range at ${viewportWidth}px`, async ({page}) => {
    const dailyHistory = Array.from({length: 566}, (_, index) => {
        const date = new Date(Date.UTC(2025, 0, 1 + index));
        const close = 100 + (index * 0.25);
        return {
            date: date.toISOString().slice(0, 10),
            close,
        };
    });
    const tradingDays = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-20'];
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2025-01-02', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1000},
        ],
        tradingDays,
        priceHistoryByTicker: {QQQ: dailyHistory},
        intradayRows: (url) => String(url.searchParams.get('days') || '')
            .split(',')
            .filter(Boolean)
            .flatMap((day, dayIndex) => [
                {date: `${day} 09:30`, open: 200 + dayIndex, high: 201 + dayIndex, low: 199 + dayIndex, close: 200.25 + dayIndex},
                {date: `${day} 15:59`, open: 201 + dayIndex, high: 202 + dayIndex, low: 200 + dayIndex, close: 201.25 + dayIndex},
            ]),
    });
    await page.setViewportSize({width: viewportWidth, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const canvas = page.locator('.investment-stock-details-price-chart-canvas');
    await expect.poll(() => canvas.evaluate((element) => Boolean(element._investmentStockDetailsChart))).toBe(true);
    const stockPriceAxisSamples = await canvas.evaluate((element) => {
        const chart = element._investmentStockDetailsChart;
        const callback = chart.options.scales.y.ticks.callback;
        return [1234, 567, 12.5, 5.5].map((value) => callback(value, 1, [{}, {}, {}]));
    });
    expect(stockPriceAxisSamples).toEqual(['1,234', '567', '12.50', '5.50']);
    const ranges = ['1w', '3m', 'ytd', '1y', 'max', 'auto'];
    for (const range of ranges) {
        await canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            if (chart) chart._e2ePreviousRangeChart = true;
        });
        await page.locator(`label[for="investment_stock_details_range_${range}"]`).click();
        await expect(page.locator(`#investment_stock_details_range_${range}`)).toBeChecked();
        await expect.poll(() => canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            return Boolean(
                chart?.chartArea
                && chart?.data?.labels?.length
                && !chart._e2ePreviousRangeChart
            );
        }), {timeout: 30_000}).toBe(true);
        await canvas.scrollIntoViewIfNeeded();
        const layout = await canvas.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const card = element.closest('.investment-stock-details-price-chart-card').getBoundingClientRect();
            const panel = document.querySelector('#stock_panel').getBoundingClientRect();
            const donut = document.querySelector('.investment-stock-details-donut-card').getBoundingClientRect();
            return {
                height: rect.height,
                insideCard: rect.top >= card.top - 1 && rect.bottom <= card.bottom + 1,
                insidePanel: rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1,
                donutOverlaps: donut.left < rect.right && donut.right > rect.left
                    && donut.top < rect.bottom && donut.bottom > rect.top,
            };
        });
        expect(layout.height).toBeGreaterThanOrEqual(199);
        expect(layout.insideCard).toBe(true);
        expect(layout.insidePanel).toBe(true);
        expect(layout.donutOverlaps).toBe(false);

        const hoverPoint = await canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            const rect = element.getBoundingClientRect();
            return {
                deltaY: Math.max(1, Math.min(25, Math.floor(chart.chartArea.height / 4))),
                x: Math.floor(rect.left + ((chart.chartArea.left + chart.chartArea.right) / 2)),
                y: Math.floor(rect.top + ((chart.chartArea.top + chart.chartArea.bottom) / 2)),
            };
        });
        await page.mouse.move(hoverPoint.x, hoverPoint.y);
        await expect.poll(() => canvas.evaluate((element) => (
            element._investmentStockDetailsChart?._activeInvestmentStockDetailsGuideBounds?.formattedPrice || ''
        ))).toMatch(/^-?\d{1,3}(?:,\d{3})*\.\d{2,}$/);

        const dateBadge = page.locator('[data-investment-stock-details-hover-date-label]');
        await expect(dateBadge).toHaveCount(1);
        await expect(dateBadge).toBeVisible();
        await expect(dateBadge).toHaveClass(/trade-chart-hover-date-label investment-equity-hover-date-label/);
        const badgeState = await canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            const badge = element.parentElement.querySelector('[data-investment-stock-details-hover-date-label]');
            const date = new Date(`${chart.data.labels[chart._activeInvestmentStockDetailsGuideIndex].slice(0, 10)}T12:00:00Z`);
            const rect = badge.getBoundingClientRect();
            const canvasRect = element.getBoundingClientRect();
            const style = getComputedStyle(badge);
            return {
                text: Array.from(badge.children).map((line) => line.textContent),
                expected: [`${date.getUTCDate()} ${date.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})}`, `${date.getUTCFullYear()}`],
                topDelta: Math.abs(rect.top - (canvasRect.top + chart.chartArea.bottom * canvasRect.height / chart.height)),
                background: style.backgroundColor,
                color: style.color,
                height: style.height,
                fontSize: style.fontSize,
            };
        });
        expect(badgeState.text).toEqual(badgeState.expected);
        expect(badgeState.topDelta).toBeLessThan(1);
        expect(badgeState).toMatchObject({background: 'rgb(0, 85, 204)', color: 'rgb(255, 255, 255)', height: '20px', fontSize: '12px'});

        const readIntersection = () => canvas.evaluate((element) => {
            const chart = element._investmentStockDetailsChart;
            return {
                x: chart._activeInvestmentStockDetailsGuideX,
                y: chart._activeInvestmentStockDetailsGuideY,
            };
        });
        const initialIntersection = await readIntersection();
        const expectedIntersection = await canvas.evaluate((element, pointerX) => {
            const chart = element._investmentStockDetailsChart;
            const x = (pointerX - element.getBoundingClientRect().left)
                * chart.width / element.getBoundingClientRect().width;
            const points = chart.getDatasetMeta(0).data;
            const rightIndex = points.findIndex((point) => point.x >= x);
            const right = points[Math.max(0, rightIndex)];
            const left = points[Math.max(0, rightIndex - 1)];
            const fraction = right.x > left.x ? (x - left.x) / (right.x - left.x) : 0;
            return {x, y: left.y + (right.y - left.y) * fraction};
        }, hoverPoint.x);
        expect(initialIntersection.x).toBeCloseTo(expectedIntersection.x, 1);
        expect(initialIntersection.y).toBeCloseTo(expectedIntersection.y, 1);
        await page.mouse.move(hoverPoint.x, hoverPoint.y + hoverPoint.deltaY);
        expect(await readIntersection()).toEqual(initialIntersection);

        await expect.poll(() => canvas.evaluate((element, injectFractionalTick) => {
            const chart = element._investmentStockDetailsChart;
            const initialBounds = chart?._activeInvestmentStockDetailsGuideBounds;
            const yScale = chart?.scales?.y;
            if (
                !chart
                || !initialBounds
                || !Array.isArray(yScale?._labelItems)
            ) return null;
            const hoverPlugin = chart.config.plugins.find((plugin) => plugin.id === 'investmentStockDetailsHoverGuidePlugin');
            const sourceAxisLabelItem = yScale._labelItems
                .find((item) => String(item?.label ?? '').trim());
            const syntheticFractionalLabelItem = injectFractionalTick && sourceAxisLabelItem
                ? {...sourceAxisLabelItem, label: '19.21'}
                : null;
            if (syntheticFractionalLabelItem) {
                yScale._labelItems.push(syntheticFractionalLabelItem);
                hoverPlugin.afterDatasetsDraw(chart);
            }
            const bounds = chart._activeInvestmentStockDetailsGuideBounds;
            const visibleAxisLabelItems = yScale._labelItems
                .filter((item) => String(item?.label ?? '').trim());
            const axisLabelItem = visibleAxisLabelItems
                .find((item) => String(item?.label ?? '').includes('.'))
                || visibleAxisLabelItems[0];
            const axisLabelOptions = axisLabelItem.options;
            const axisTickCopy = String(axisLabelItem.label);
            const context = element.getContext('2d');
            context.save();
            context.font = axisLabelItem.font.string;
            const axisTickWidth = context.measureText(axisTickCopy).width;
            const axisLabelTranslationX = Number(axisLabelOptions.translation[0]);
            const axisTextAlign = String(axisLabelOptions.textAlign || 'right');
            const expectedAxisLabelRight = axisLabelTranslationX + (
                axisTextAlign === 'center'
                    ? axisTickWidth / 2
                    : (axisTextAlign === 'left' || axisTextAlign === 'start' ? axisTickWidth : 0)
            );
            const axisTickDecimalIndex = axisTickCopy.lastIndexOf('.');
            const axisFractionCopy = axisTickDecimalIndex >= 0
                ? axisTickCopy.slice(axisTickDecimalIndex)
                : '';
            const expectedDecimalAnchor = expectedAxisLabelRight - context.measureText(axisFractionCopy).width;
            context.restore();
            const result = {
                axisAnchorDelta: Math.abs(bounds.decimalAnchor - expectedDecimalAnchor),
                axisLabelRightDelta: Math.abs(bounds.axisLabelRight - expectedAxisLabelRight),
                axisTickHasFraction: axisTickDecimalIndex >= 0,
                badgeCoversAxis: bounds.badgeLeft < chart.chartArea.left && bounds.badgeRight > chart.chartArea.left - 4,
                exactPriceDelta: Math.abs(bounds.price - chart.scales.y.getValueForPixel(bounds.y)),
                hasLayeredHooks: typeof hoverPlugin?.beforeDatasetsDraw === 'function'
                    && typeof hoverPlugin?.afterDatasetsDraw === 'function',
                leftDelta: Math.abs(bounds.left - chart.chartArea.left),
                rightDelta: Math.abs(bounds.right - chart.chartArea.right),
                yWithinPlot: bounds.y >= chart.chartArea.top && bounds.y <= chart.chartArea.bottom,
            };
            if (syntheticFractionalLabelItem) yScale._labelItems.pop();
            return result;
        }, range === '1w')).toEqual({
            axisAnchorDelta: 0,
            axisLabelRightDelta: 0,
            axisTickHasFraction: range === '1w',
            badgeCoversAxis: true,
            exactPriceDelta: 0,
            hasLayeredHooks: true,
            leftDelta: 0,
            rightDelta: 0,
            yWithinPlot: true,
        });
        await page.mouse.move(0, 0);
        await expect.poll(readIntersection).toEqual({x: null, y: null});
        await expect(dateBadge).toBeHidden();
        expect(await canvas.evaluate((element) => (
            element._investmentStockDetailsChart._activeInvestmentStockDetailsGuideBounds
        ))).toBeNull();

    }
});

}

test('keeps stock details as the only visible transaction table and preserves exact row hover', async ({page}) => {
    const transactions = Array.from({length: 20}, (_, index) => ({
        ledger_no: 7000 + index,
        broker: 'ibkr',
        date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        type: 'buy',
        ticker: index % 2 === 0 ? 'DRAM' : 'MSFT',
        currency: 'USD',
        quantity: 1,
        price: 50 + index,
        amount: -(50 + index),
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.setViewportSize({width: 920, height: 900});
    await page.goto('/trade/investment?ticker=DRAM#stock_panel');
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(page.locator('tr[data-investment-stock-detail-ledger]')).toHaveCount(10);
    const stockDates = await page.locator('tr[data-investment-stock-detail-ledger]').evaluateAll((rows) => (
        rows.map((row) => Date.parse(row.cells.item(2)?.textContent?.trim() || ''))
    ));
    expect(stockDates).toEqual([...stockDates].sort((left, right) => right - left));
    await expect(page.locator('#history_table_wrap')).toBeHidden();
    await expect(page.locator('#investment_history_surface .investment-history-table-shell:visible')).toHaveCount(1);
    await expect(page.locator('#investment_history_pagination')).toBeHidden();

    const upperLedger = page.locator('tr[data-investment-stock-detail-ledger]').first();
    await expect(upperLedger).toHaveAttribute('data-stock-history-bound', '1');
    await upperLedger.hover();
    await expect(upperLedger).toHaveClass(/is-metric-hover-active/);
});

