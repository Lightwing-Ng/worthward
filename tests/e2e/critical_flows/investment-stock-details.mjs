/* Code version: v1.2.0 */
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
test('uses the Neo stock-details composition without chart or donut collisions', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: -501},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 502, amount: 502},
            {broker: 'hsbc', date: '2026-07-13', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 503, amount: -503},
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 504, amount: -504},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
                {date: '2026-07-12', close: 502},
                {date: '2026-07-13', close: 503},
                {date: '2026-07-14', close: 504},
            ],
        },
        tickerProfiles: {
            QQQ: {
                ticker: 'QQQ',
                company_name: 'Invesco QQQ Trust',
                logo_url: '/market-store/logos/QQQ.svg',
            },
        },
    });
    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');
    const currentModuleVersion = async (relativePath) => {
        const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
        return source.match(/Code version: (v[0-9.]+)/)[1];
    };
    const currentEntryVersion = await currentModuleVersion('../../../app/web/static/assets/js/investment.js');
    const currentDataUtilsVersion = await currentModuleVersion('../../../app/web/static/assets/js/investment/data-utils.js');
    const currentPaginationVersion = await currentModuleVersion('../../../app/web/static/assets/js/investment/pagination.js');
    const currentStockDetailsVersion = await currentModuleVersion('../../../app/web/static/assets/js/investment/stock-details.js');
    const currentTransactionTableVersion = await currentModuleVersion('../../../app/web/static/assets/js/investment/transaction-table.js');
    await expect.poll(() => page.evaluate(() => window.WORTHWARD_INVESTMENT_MODULE_VERSIONS)).toEqual({
        entry: currentEntryVersion,
        chartOrbit: 'v1.39.0',
        dataUtils: currentDataUtilsVersion,
        importFeedback: 'v1.10.0',
        layout: 'v1.5.1',
        pagination: currentPaginationVersion,
        realtime: 'v1.3.3',
        numericDisplay: 'v1.1.0',
        stockDetails: currentStockDetailsVersion,
        transactionFilters: 'v1.3.0',
        transactionTable: currentTransactionTableVersion,
        urlState: 'v1.2.0',
    });
    await expect.poll(() => page.evaluate((version) => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/js/investment/stock-details.js')
            && url.searchParams.get('v') === `investment-stock-details-${version}`;
    }), currentStockDetailsVersion)).toBe(true);
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/js/investment/import-feedback.js')
            && url.searchParams.get('v') === 'investment-import-feedback-v1.10.0';
    }))).toBe(true);
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/js/chart.js')
            && url.searchParams.get('v')?.endsWith('-chart-v0.14.0');
    }))).toBe(true);
    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'false');
    const priceChartCanvas = page.locator('#stock_panel .investment-stock-details-price-chart-canvas');
    await expect(priceChartCanvas).toBeVisible();
    await priceChartCanvas.evaluate(async () => {
        await document.fonts.ready;
        await Promise.allSettled(document.getAnimations().filter((animation) => (
            Number.isFinite(animation.effect?.getTiming().iterations)
        )).map((animation) => animation.finished));
    });
    const priceChartBox = await priceChartCanvas.boundingBox();
    if (!priceChartBox) throw new Error('Stock-details price chart has no visible box.');
    await page.mouse.move(
        priceChartBox.x + (priceChartBox.width * 0.55),
        priceChartBox.y + (priceChartBox.height * 0.52),
    );
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        return Boolean(chart?._activeInvestmentStockDetailsGuideBounds?.formattedPrice);
    })).toBe(true);
    const hoverBadgePixels = await page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        const bounds = chart?._activeInvestmentStockDetailsGuideBounds;
        const context = canvas?.getContext('2d');
        if (!canvas || !bounds || !context) return null;
        // Chart bounds use logical canvas coordinates, independent of a CSS
        // transition on its container. Sample the rounded corner as a region;
        // rounding bounds + 0.5 can select a fully filled interior pixel.
        const scaleX = canvas.width / chart.width;
        const scaleY = canvas.height / chart.height;
        const readPixel = (x, y) => Array.from(context.getImageData(
            Math.round(x * scaleX),
            Math.round(y * scaleY),
            1,
            1,
        ).data);
        const cornerLeft = Math.max(0, Math.floor(bounds.badgeLeft * scaleX));
        const cornerTop = Math.max(0, Math.floor(bounds.badgeTop * scaleY));
        const cornerSize = Math.max(2, Math.ceil(2 * Math.min(scaleX, scaleY)));
        const cornerPixels = context.getImageData(cornerLeft, cornerTop, cornerSize, cornerSize).data;
        const center = readPixel((bounds.badgeLeft + bounds.badgeRight) / 2, (bounds.badgeTop + bounds.badgeBottom) / 2);
        return {
            allocationBadgeRadius: getComputedStyle(canvas)
                .getPropertyValue('--investment-holdings-allocation-badge-radius').trim(),
            cornerHasUnfilledPixels: Array.from({length: cornerPixels.length / 4}, (_, index) => (
                Array.from(cornerPixels.slice(index * 4, index * 4 + 4)).some((value, channel) => value !== center[channel])
            )).some(Boolean),
        };
    });
    expect(hoverBadgePixels).not.toBeNull();
    expect(hoverBadgePixels.allocationBadgeRadius).toBe('2px');
    expect(hoverBadgePixels.cornerHasUnfilledPixels).toBe(true);

    const coalescedHover = await priceChartCanvas.evaluate(async (canvas) => {
        const chart = canvas._investmentStockDetailsChart;
        const rect = canvas.getBoundingClientRect();
        const originalUpdate = chart.update.bind(chart);
        let updateCalls = 0;
        chart.update = (...args) => {
            updateCalls += 1;
            return originalUpdate(...args);
        };
        const startX = rect.left + (rect.width * 0.42);
        const endX = rect.left + (rect.width * 0.62);
        const pointerY = rect.top + (rect.height * 0.48);
        for (let index = 0; index < 24; index += 1) {
            const progress = index / 23;
            canvas.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                clientX: startX + ((endX - startX) * progress),
                clientY: pointerY,
            }));
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        chart.update = originalUpdate;
        return {
            updateCalls,
            guideX: chart._activeInvestmentStockDetailsGuideX,
            expectedGuideX: (endX - rect.left) * chart.width / rect.width,
        };
    });
    expect(coalescedHover.updateCalls).toBe(1);
    expect(Math.abs(
        coalescedHover.guideX - coalescedHover.expectedGuideX,
    )).toBeLessThanOrEqual(1);

    await priceChartCanvas.evaluate((canvas) => {
        canvas._investmentStockDetailsChart._e2eThemeIdentity = true;
    });
    await page.locator('#global_theme_toggle').click();
    await expect.poll(() => priceChartCanvas.evaluate((canvas) => ({
        sameChart: canvas._investmentStockDetailsChart?._e2eThemeIdentity === true,
        hasInPlaceThemeSync: typeof canvas._syncInvestmentStockDetailsTheme === 'function',
    }))).toEqual({sameChart: true, hasInPlaceThemeSync: true});

    const readGeometry = () => page.evaluate(() => {
        const select = (selector) => document.querySelector(`#stock_panel ${selector}`);
        const identity = select('.investment-stock-details-identity');
        const metrics = select('.investment-stock-details-metrics');
        const chartCard = select('.investment-stock-details-price-chart-card');
        const range = select('.investment-stock-details-range-shell');
        const chartShell = select('.investment-stock-details-price-chart-shell');
        const canvas = select('.investment-stock-details-price-chart-canvas');
        const donutCard = select('.investment-stock-details-donut-card');
        const donutShell = select('.investment-stock-details-donut-shell');
        const donut = select('.investment-stock-details-donut');
        const logo = select('.investment-stock-details-donut-logo');
        if (!identity || !metrics || !chartCard || !range || !chartShell || !canvas
            || !donutCard || !donutShell || !donut || !logo) return null;
        const identityRect = identity.getBoundingClientRect();
        const metricsRect = metrics.getBoundingClientRect();
        const chartCardRect = chartCard.getBoundingClientRect();
        const rangeRect = range.getBoundingClientRect();
        const chartRect = chartShell.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const donutCardRect = donutCard.getBoundingClientRect();
        const donutShellRect = donutShell.getBoundingClientRect();
        const donutRect = donut.getBoundingClientRect();
        const logoRect = logo.getBoundingClientRect();
        return {
            identityTop: identityRect.top,
            rangeTop: rangeRect.top,
            rangeBottom: rangeRect.bottom,
            chartTop: chartRect.top,
            chartBottom: chartRect.bottom,
            canvasBottom: canvasRect.bottom,
            chartCardTop: chartCardRect.top,
            chartCardBottom: chartCardRect.bottom,
            metricsBottom: metricsRect.bottom,
            metricsOverflow: metrics.scrollHeight - metrics.clientHeight,
            metricsOverflowY: getComputedStyle(metrics).overflowY,
            chartCenterY: chartRect.top + (chartRect.height / 2),
            donutCenterY: donutRect.top + (donutRect.height / 2),
            donutDiameter: donutRect.width,
            donutFrameWidth: donutShellRect.width,
            donutCardBottom: donutCardRect.bottom,
            logoContained: (
                logoRect.left >= donutShellRect.left - 1
                && logoRect.right <= donutShellRect.right + 1
                && logoRect.top >= donutShellRect.top - 1
                && logoRect.bottom <= donutShellRect.bottom + 1
            ),
        };
    });
    const verticalAlignmentTolerance = 2.1;

    await expect.poll(async () => {
        const currentGeometry = await readGeometry();
        if (!currentGeometry) return Number.POSITIVE_INFINITY;
        return Math.abs(currentGeometry.chartCenterY - currentGeometry.donutCenterY);
    }).toBeLessThanOrEqual(verticalAlignmentTolerance);
    const geometry = await readGeometry();

    expect(geometry).not.toBeNull();
    expect(Math.abs(geometry.identityTop - geometry.rangeTop)).toBeLessThanOrEqual(1);
    expect(geometry.rangeBottom).toBeLessThanOrEqual(geometry.chartTop);
    expect(Math.abs(geometry.chartBottom - geometry.canvasBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCardTop - geometry.identityTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCardBottom - geometry.metricsBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCardBottom - geometry.donutCardBottom)).toBeLessThanOrEqual(1);
    expect(geometry.metricsOverflowY).toBe('auto');
    // Metrics own a scrollport; a growing metric list must remain reachable
    // without enlarging or colliding with the neighboring chart and donut.
    expect(await page.locator('#stock_panel .investment-stock-details-metrics').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollHeight - element.clientHeight - element.scrollTop;
    })).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.chartCenterY - geometry.donutCenterY)).toBeLessThanOrEqual(
        verticalAlignmentTolerance,
    );
    expect(geometry.donutDiameter).toBeGreaterThan(120);
    expect(geometry.donutFrameWidth - geometry.donutDiameter).toBeLessThanOrEqual(50);
    expect(geometry.logoContained).toBe(true);

    await page.setViewportSize({width: 430, height: 900});
    await expect.poll(() => page.evaluate(() => {
        const shell = document.querySelector('#stock_panel .investment-stock-details-donut-shell')
            ?.getBoundingClientRect();
        const logo = document.querySelector('#stock_panel .investment-stock-details-donut-logo')
            ?.getBoundingClientRect();
        return Boolean(shell && logo
            && logo.left >= shell.left - 1
            && logo.right <= shell.right + 1
            && logo.top >= shell.top - 1
            && logo.bottom <= shell.bottom + 1);
    })).toBe(true);
    const mobileDonutGeometry = await page.evaluate(() => {
        const shell = document.querySelector('#stock_panel .investment-stock-details-donut-shell')
            .getBoundingClientRect();
        const donut = document.querySelector('#stock_panel .investment-stock-details-donut')
            .getBoundingClientRect();
        return {
            frameWidth: shell.width,
            frameHeight: shell.height,
            donutDiameter: donut.width,
        };
    });
    expect(Math.abs(mobileDonutGeometry.frameWidth - mobileDonutGeometry.frameHeight)).toBeLessThanOrEqual(1);
    expect(mobileDonutGeometry.frameWidth - mobileDonutGeometry.donutDiameter).toBeLessThanOrEqual(50);
});

for (const viewport of [
    {width: 996, height: 801},
    {width: 390, height: 844},
]) {
    test(`keeps Stock details metric layout fixed through live digit updates at ${viewport.width}px`, async ({page}) => {
        await mockInvestmentReadApis(page, {
            brokers: ['ibkr', 'hsbc'],
            transactions: [
                {
                    ledger_no: 1,
                    broker: 'ibkr',
                    date: '2026-07-10',
                    type: 'buy',
                    ticker: 'DRAM',
                    currency: 'USD',
                    quantity: 5,
                    price: 50,
                    amount: -250,
                },
                {
                    ledger_no: 2,
                    broker: 'hsbc',
                    date: '2026-07-10',
                    type: 'buy',
                    ticker: 'DRAM',
                    currency: 'USD',
                    quantity: 5,
                    price: 50,
                    amount: -250,
                },
            ],
            priceHistoryByTicker: {
                DRAM: [
                    {date: '2026-07-10', close: 50},
                    {date: '2026-07-13', close: 51},
                ],
            },
            tickerProfiles: {
                DRAM: {ticker: 'DRAM', company_name: 'Roundhill Memory ETF'},
            },
        });
        await page.setViewportSize(viewport);
        await page.goto('/trade/investment?view=stock-details&ticker=DRAM&range=1y');
        await setSidebarExpanded(page, false);
        const metricGrid = page.locator('#stock_panel .investment-stock-details-metrics');
        await expect(metricGrid).toBeVisible();
        await expect(metricGrid.locator('.investment-stock-details-metric-card')).toHaveCount(10);
        const marketValueCard = metricGrid.locator('.investment-stock-details-metric-card')
            .filter({has: page.locator('.trade-metric-label', {hasText: /^Market value$/})});
        await expect(marketValueCard.locator('.investment-stock-details-metric-value-row')).toHaveCount(1);
        await expect(marketValueCard.locator('.investment-stock-details-metric-breakdown')).toHaveCount(1);
        await expect(page.locator('#stock_panel .investment-stock-details-price-chart-canvas')).toBeVisible();

        const geometry = await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.allSettled(document.getAnimations().filter((animation) => (
                Number.isFinite(animation.effect?.getTiming().iterations)
            )).map((animation) => animation.finished));

            const {createInvestmentLiveValueAnimator} = await import(
                '/static/assets/js/investment/realtime.js'
            );
            const {renderNumericDisplayContent} = await import(
                '/static/assets/js/numeric-display.js'
            );
            const animator = createInvestmentLiveValueAnimator({
                easeOutCubic: (progress) => 1 - ((1 - progress) ** 3),
                renderWorkspaceMetricValueContent: renderNumericDisplayContent,
                scheduler: window.WorthwardMotion?.scheduler,
            });
            const panel = document.querySelector('#stock_panel');
            const metrics = panel?.querySelector('.investment-stock-details-metrics');
            const cards = Array.from(metrics?.querySelectorAll(':scope > .investment-stock-details-metric-card') || []);
            const liveFields = [
                'stock_unrealized_pnl',
                'stock_total_pnl',
                'stock_market_value',
                'stock_last_price',
                'stock_position_weight',
            ];
            const liveNodes = new Map(liveFields.map((field) => [
                field,
                metrics?.querySelector(`[data-investment-live-field="${field}"]`),
            ]));
            if (!metrics || cards.length !== 10 || [...liveNodes.values()].some((node) => !(node instanceof HTMLElement))) {
                return null;
            }
            const marketValue = liveNodes.get('stock_market_value');
            const rect = (element) => {
                const box = element.getBoundingClientRect();
                return [box.x, box.y, box.width, box.height];
            };
            const sample = () => ({
                boxes: [
                    rect(panel.querySelector('.investment-stock-details-overview')),
                    rect(metrics),
                    rect(panel.querySelector('.investment-stock-details-price-chart-card')),
                    rect(panel.querySelector('.investment-stock-details-price-chart-shell')),
                    rect(panel.querySelector('.investment-stock-details-donut-card')),
                    ...cards.flatMap((card) => [
                        rect(card),
                        rect(card.querySelector('.trade-metric-label')),
                        rect(card.querySelector('.investment-stock-details-metric-value')),
                    ]),
                ],
                metricsScrollHeight: metrics.scrollHeight,
                metricsScrollWidth: metrics.scrollWidth,
                metricsClientWidth: metrics.clientWidth,
                marketValuePaddingBottom: getComputedStyle(marketValue).paddingBottom,
                documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                valueOverflow: cards.map((card) => {
                    const value = card.querySelector('.investment-stock-details-metric-value');
                    return Math.max(0, value.scrollWidth - value.clientWidth);
                }),
            });
            const baseline = sample();
            const frames = [];
            const transitions = [
                {
                    stock_unrealized_pnl: ['999.99', 999.99],
                    stock_total_pnl: ['999.99', 999.99],
                    stock_market_value: ['999.99', 999.99],
                    stock_last_price: ['9.99', 9.99],
                    stock_position_weight: ['9.99%', 9.99],
                },
                {
                    stock_unrealized_pnl: ['1,000.00', 1000],
                    stock_total_pnl: ['1,000.00', 1000],
                    stock_market_value: ['1,000.00', 1000],
                    stock_last_price: ['10.00', 10],
                    stock_position_weight: ['10.00%', 10],
                },
                {
                    stock_unrealized_pnl: ['-999.99', -999.99],
                    stock_total_pnl: ['-999.99', -999.99],
                    stock_market_value: ['999.99', 999.99],
                    stock_last_price: ['9.99', 9.99],
                    stock_position_weight: ['9.99%', 9.99],
                },
            ];
            for (const transition of transitions) {
                for (const [field, [display, number]] of Object.entries(transition)) {
                    animator.updateInvestmentLiveValueNode(liveNodes.get(field), display, number);
                }
                frames.push(sample());
                for (let frame = 0; frame < 38; frame += 1) {
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                    frames.push(sample());
                }
            }

            return {baseline, frames};
        });
        expect(geometry).not.toBeNull();
        const maxDelta = Math.max(...geometry.frames.flatMap((frame) => frame.boxes.flatMap((box, index) => (
            box.map((dimension, coordinate) => Math.abs(dimension - geometry.baseline.boxes[index][coordinate]))
        ))));
        expect(maxDelta).toBeLessThanOrEqual(1);
        expect(geometry.baseline.marketValuePaddingBottom).toBe('0px');
        expect(geometry.frames.every((frame) => frame.metricsScrollHeight === geometry.baseline.metricsScrollHeight)).toBe(true);
        expect(geometry.frames.every((frame) => (
            frame.documentOverflow <= 1
            && frame.metricsScrollWidth - frame.metricsClientWidth <= 1
            && frame.valueOverflow.every((overflow) => overflow <= 1)
        ))).toBe(true);

        await page.emulateMedia({reducedMotion: 'reduce'});
        const reducedMotion = await page.evaluate(async () => {
            const {createInvestmentLiveValueAnimator} = await import(
                '/static/assets/js/investment/realtime.js'
            );
            const {renderNumericDisplayContent} = await import(
                '/static/assets/js/numeric-display.js'
            );
            const animator = createInvestmentLiveValueAnimator({
                easeOutCubic: (progress) => 1 - ((1 - progress) ** 3),
                renderWorkspaceMetricValueContent: renderNumericDisplayContent,
                scheduler: window.WorthwardMotion?.scheduler,
            });
            const metrics = document.querySelector('#stock_panel .investment-stock-details-metrics');
            const cards = Array.from(metrics.querySelectorAll(':scope > .investment-stock-details-metric-card'));
            const rect = (element) => {
                const box = element.getBoundingClientRect();
                return [box.x, box.y, box.width, box.height];
            };
            const boxes = () => cards.flatMap((card) => [
                rect(card),
                rect(card.querySelector('.trade-metric-label')),
                rect(card.querySelector('.investment-stock-details-metric-value')),
            ]);
            const baseline = boxes();
            const value = metrics.querySelector('[data-investment-live-field="stock_unrealized_pnl"]');
            animator.updateInvestmentLiveValueNode(value, '1,000.00', 1000);
            const immediate = boxes();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const nextFrame = boxes();
            return {
                baseline,
                immediate,
                nextFrame,
                animatedDigits: metrics.querySelectorAll('.investment-live-digit--changed').length,
                documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });
        for (const boxes of [reducedMotion.immediate, reducedMotion.nextFrame]) {
            expect(boxes.every((box, index) => box.every((dimension, coordinate) => (
                Math.abs(dimension - reducedMotion.baseline[index][coordinate]) <= 1
            )))).toBe(true);
        }
        expect(reducedMotion.animatedDigits).toBe(0);
        expect(reducedMotion.documentOverflow).toBeLessThanOrEqual(1);
    });
}

test('keeps QQQI Stock details cost labels out of metrics and tooltip', async ({page}) => {
    const ticker = 'QQQI';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker, currency: 'USD', quantity: 2, price: 50, amount: -100},
            {broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker, currency: 'USD', quantity: 1, price: 52, amount: -52},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker, currency: 'USD', quantity: 1, price: 55, amount: 55},
        ],
        priceHistoryByTicker: {
            [ticker]: [
                {date: '2026-07-10', close: 50},
                {date: '2026-07-11', close: 52},
                {date: '2026-07-12', close: 55},
            ],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'NEOS Nasdaq-100 High Income ETF',
                logo_url: '/market-store/logos/QQQI.svg',
            },
        },
    });
    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/trade/investment?view=stock-details&ticker=QQQI&range=auto');

    const stockPanel = page.locator('#stock_panel');
    await expect(stockPanel).toBeVisible();
    await expect(stockPanel.locator('.trade-metric-label').filter({hasText: /^Average price$/})).toHaveCount(1);
    for (const forbiddenLabel of [
        'Lowest-cost lots first',
        'FIFO',
        'LIFO',
        'Moving average cost',
        'FIFO reconstructed',
    ]) {
        await expect(stockPanel).not.toContainText(forbiddenLabel);
    }

    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        const dataset = chart?.data?.datasets?.[0]?.data || [];
        const index = dataset.findIndex((value) => Number.isFinite(value));
        const point = index >= 0 ? chart?.getDatasetMeta(0)?.data?.[index] : null;
        if (!chart || !point) return false;
        const center = point.getCenterPoint();
        const activeElements = [{datasetIndex: 0, index}];
        chart.setActiveElements(activeElements);
        chart.tooltip?.setActiveElements(activeElements, {x: center.x, y: center.y});
        chart.update('none');
        return true;
    })).toBe(true);

    const tooltip = page.locator('[data-investment-stock-details-tooltip="1"]');
    await expect(tooltip).toHaveClass(/is-visible/);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^Average price$/})).toHaveCount(1);
    for (const forbiddenLabel of [
        'Lowest-cost lots first',
        'FIFO',
        'LIFO',
        'Moving average cost',
        'FIFO reconstructed',
    ]) {
        await expect(tooltip).not.toContainText(forbiddenLabel);
    }
    const chartDatasetLabels = await page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        return window.Chart?.getChart?.(canvas)?.data?.datasets?.map((dataset) => dataset.label) || [];
    });
    expect(chartDatasetLabels).toContain('QQQI Average price');
});

test('keeps the latest average-price chart point on the configured transaction replay', async ({page}) => {
    const ticker = 'DRAM';
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker, currency: 'USD', quantity: 5, price: 100, amount: -500},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker, currency: 'USD', quantity: 1, price: 50, amount: -50},
            {ledger_no: 3, broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker, currency: 'USD', quantity: 1, price: 120, amount: 120},
        ],
        summary: {
            position_snapshot_authoritative: true,
            position_snapshot_as_of: '2026-07-12',
        },
        positionSnapshot: {
            [ticker]: {
                quantity: '5',
                cost_basis_status: 'known',
                cost_price: '90',
                market_value: '600',
                last_price: '120',
            },
        },
        priceHistoryByTicker: {
            [ticker]: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 50},
                {date: '2026-07-12', close: 120},
            ],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Roundhill Memory ETF',
                logo_url: '/market-store/logos/DRAM.svg',
            },
        },
    });
    await page.setViewportSize({width: 920, height: 900});
    await page.goto(`/trade/investment?view=stock-details&ticker=${ticker}`);
    await page.locator('label[for="investment_stock_details_range_max"]').click();
    const averagePriceMetricCard = page.locator('#stock_panel .trade-metric-card')
        .filter({hasText: 'Average price'});
    await expect(averagePriceMetricCard).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        return Boolean(chart?.data?.datasets?.length && chart?.data?.labels?.length);
    })).toBe(true);

    const parity = await page.evaluate(() => {
        const metricCard = [...document.querySelectorAll('#stock_panel .trade-metric-card')]
            .find((card) => card.querySelector('.trade-metric-label')?.textContent?.trim() === 'Average price');
        const metricText = metricCard?.querySelector('.trade-metric-value')?.textContent || '';
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        const averageDataset = chart?.data?.datasets?.find((dataset) => (
            String(dataset.label || '').endsWith('Average price')
        ));
        return {
            metric: Number(metricText.replaceAll(',', '').trim()),
            latestAveragePrice: Number(averageDataset?.data?.at(-1)),
        };
    });
    expect(parity.metric).toBe(90);
    expect(parity.latestAveragePrice).toBeCloseTo(100, 8);
});

test('shows date-scoped realized and unrealized P&L in the Stock details tooltip', async ({page}) => {
    const ticker = 'DRAM';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-08-01', type: 'buy', ticker, currency: 'USD', quantity: 10, price: 100, amount: -1_000},
            {broker: 'ibkr', date: '2026-08-02', type: 'sell', ticker, currency: 'USD', quantity: 4, price: 120, amount: 480},
        ],
        priceHistoryByTicker: {
            [ticker]: [
                {date: '2026-08-01', close: 110},
                {date: '2026-08-02', close: 120},
            ],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Roundhill Memory ETF',
                logo_url: '/market-store/logos/DRAM.svg',
            },
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto(`/trade/investment?view=stock-details&ticker=${ticker}&range=auto`);

    const tooltip = page.locator('[data-investment-stock-details-tooltip="1"]');
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#stock_panel .investment-stock-details-price-chart-canvas');
        const chart = canvas && window.Chart?.getChart?.(canvas);
        const values = chart?.data?.datasets?.[0]?.data || [];
        const indexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        const index = indexes[indexes.length - 1] ?? -1;
        const point = index >= 0 ? chart?.getDatasetMeta(0)?.data?.[index] : null;
        if (!chart || !point) return false;
        const center = point.getCenterPoint();
        const activeElements = [{datasetIndex: 0, index}];
        chart.setActiveElements(activeElements);
        chart.tooltip?.setActiveElements(activeElements, {x: center.x, y: center.y});
        chart.update('none');
        return true;
    })).toBe(true);
    await expect(tooltip).toHaveClass(/is-visible/);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^Unrealized P&L$/})).toHaveCount(1);
    await expect(tooltip.locator('.chart-tooltip-label').filter({hasText: /^Realized P&L$/})).toHaveCount(1);

    const pnlValues = await tooltip.locator('.chart-tooltip-row').evaluateAll((rows) => Object.fromEntries(
        rows
            .map((row) => [
                row.querySelector('.chart-tooltip-label')?.textContent || '',
                row.querySelector('.chart-tooltip-value')?.textContent || '',
            ])
            .filter(([label]) => ['Unrealized P&L', 'Realized P&L'].includes(label)),
    ));
    expect(pnlValues).toEqual({
        'Unrealized P&L': '120.00',
        'Realized P&L': '80.00',
    });
});

test('uses the standard green token logo for money-market Stock details identity', async ({page}) => {
    const ticker = '005276756';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker, currency: 'USD', quantity: 1, price: 1, amount: -1},
        ],
        priceHistoryByTicker: {
            [ticker]: [{date: '2026-07-14', close: 1}],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund',
                logo_url: '/market-store/logos/dollarsign.ring.svg',
            },
        },
        moneyMarketTickers: [ticker],
    });
    await page.goto(`/trade/investment?ticker=${ticker}#stock_panel`);
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => {
        const url = new URL(entry.name);
        return url.pathname.endsWith('/assets/css/views/investment.css')
            && url.searchParams.get('v') === '1.81.2';
    }))).toBe(true);

    const tokenLogo = page.locator('#stock_panel .investment-stock-details-identity .investment-cash-equivalent-token-logo');
    await expect(tokenLogo).toHaveCount(1);
    await expect(tokenLogo).toBeVisible();
    await expect(page.locator('#stock_panel .investment-stock-details-identity .ticker-identity-symbol')).toHaveText(ticker);
    await expect(page.locator('#stock_panel .investment-stock-details-identity .ticker-identity-name'))
        .toHaveText('Franklin Templeton U.S. Dollar Short-Term Money Market Fund');
    await expect(page.locator('#stock_panel .investment-stock-details-identity img.ticker-identity-logo')).toHaveCount(0);
    await expect.poll(() => tokenLogo.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            backgroundColor: style.backgroundColor,
            maskImage: style.maskImage || style.webkitMaskImage,
        };
    })).toMatchObject({
        backgroundColor: expect.stringMatching(/rgb\(/),
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });
});

test('uses the standard green token logo for money-market Holdings and portfolio donut identities', async ({page}) => {
    const ticker = '005276756';
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker, currency: 'USD', quantity: 1, price: 1, amount: -1},
        ],
        priceHistoryByTicker: {
            [ticker]: [{date: '2026-07-14', close: 1}],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund',
                logo_url: '/market-store/logos/dollarsign.ring.svg',
            },
        },
        moneyMarketTickers: [ticker],
    });
    await page.goto('/trade/investment?view=overview');
    const holdingsRow = '#investment_holdings_panel tr[data-investment-holdings-ticker]';
    await expect.poll(() => page.locator(holdingsRow).count(), {timeout: 30_000}).toBeGreaterThan(0);

    const readTokenStyle = (selector) => (typeof selector === 'string' ? page.locator(selector) : selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            tagName: element.tagName,
            backgroundColor: style.backgroundColor,
            maskImage: style.maskImage || style.webkitMaskImage,
        };
    });
    const donutLogo = '#investment_dummy_logo_layer .portfolio-donut-logo.investment-cash-equivalent-token-logo';
    await expect(page.locator(donutLogo)).toHaveCount(1);
    await page.locator('html').evaluate((root) => root.setAttribute('data-theme-override', 'light'));
    await expect.poll(() => readTokenStyle(donutLogo)).toEqual({
        tagName: 'SPAN',
        backgroundColor: 'rgb(22, 163, 74)',
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });
    await page.locator('html').evaluate((root) => root.setAttribute('data-theme-override', 'dark'));
    await expect.poll(() => readTokenStyle(donutLogo)).toEqual({
        tagName: 'SPAN',
        backgroundColor: 'rgb(47, 255, 156)',
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });

    await page.locator('label[for="investment_view_holdings"]').click();
    const holdingsLogo = page.locator(`${holdingsRow} .investment-holdings-ticker-link .investment-cash-equivalent-token-logo`).first();
    await expect(holdingsLogo).toHaveCount(1);
    await expect.poll(() => readTokenStyle(holdingsLogo)).toMatchObject({
        tagName: 'SPAN',
        backgroundColor: 'rgb(47, 255, 156)',
        maskImage: expect.stringContaining('dollarsign.ring.svg'),
    });
});

test('uses placeholders without probing nonexistent investment logo files', async ({page}) => {
    const ticker = '584752.HK';
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-14',
                type: 'buy',
                ticker,
                currency: 'HKD',
                quantity: 1,
                price: 100,
                amount: -100,
                normalized: {
                    display_quantity: 1,
                    unit_price: 100,
                    net_amount: -100,
                },
            },
        ],
        priceHistoryByTicker: {
            [ticker]: [{date: '2026-07-14', close: 100}],
        },
        tickerProfiles: {
            [ticker]: {
                ticker,
                company_name: 'Unlisted test security',
                logo_url: '',
            },
        },
    });
    await page.goto(`/trade/investment?ticker=${encodeURIComponent(ticker)}`);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#stock_panel')).toBeVisible();
    await expect(page.locator('#stock_panel .ticker-identity-logo-placeholder')).toBeVisible();
    await expect(page.locator('#stock_panel .investment-stock-details-donut-logo')).toHaveCount(0);
    await expect(page.locator('img[loading="lazy"]')).toHaveCount(0);

    const speculativeLogoRequests = await page.evaluate((missingTicker) => (
        performance.getEntriesByType('resource')
            .map((entry) => new URL(entry.name).pathname)
            .filter((pathname) => (
                pathname.startsWith('/market-store/logos/')
                && pathname.includes(missingTicker)
            ))
    ), ticker);
    expect(speculativeLogoRequests).toEqual([]);
});

test('redraws the Overview live endpoint and breathing marker when the first regular-session quote arrives', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-22T14:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentOverviewRealtimePoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    let quotePrice = null;
    const liveQuotes = () => (Number.isFinite(quotePrice) ? [{
        ticker: 'DRAM',
        price: quotePrice,
        timestamp: '2026-07-22 10:00',
        session: 'intraday',
        session_date: '2026-07-22',
        market: 'US',
        source: 'yfinance',
    }] : []);
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-21', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 100, amount: -1000},
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-20', close: 99},
                {date: '2026-07-21', close: 100},
            ],
        },
        realtimeQuotes: liveQuotes,
        marketSession: {
            session: 'intraday',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-22',
        },
    });
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');
    await expect.poll(() => page.evaluate(() => (
        typeof window.__testTriggerInvestmentOverviewRealtimePoll
    ))).toBe('function');

    const marker = page.locator('[data-investment-equity-live-marker]');
    await expect.poll(() => marker.evaluate((element) => element.hidden)).toBe(true);
    const baselineEquity = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = chart?.data?.datasets?.[0]?.data || [];
        return Number(values[values.length - 1]);
    });

    quotePrice = 120;
    await page.evaluate(() => window.__testTriggerInvestmentOverviewRealtimePoll());
    await expect.poll(() => marker.evaluate((element) => !element.hidden)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = chart?.data?.datasets?.[0]?.data || [];
        return Number(values[values.length - 1]);
    })).not.toBe(baselineEquity);

    const markerState = await marker.evaluate((element) => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const lastIndex = chart.data.labels.length - 1;
        const lastValue = Number(chart.data.datasets[0].data[lastIndex]);
        const root = getComputedStyle(document.documentElement);
        const outer = getComputedStyle(element, '::before');
        const inner = getComputedStyle(element, '::after');
        const core = getComputedStyle(element);
        const px = (value) => Number.parseFloat(value);
        return {
            animation: outer.animationName,
            coreSize: px(core.width),
            duration: outer.animationDuration,
            innerDelay: inner.animationDelay,
            innerDiameter: px(inner.width),
            innerMinimumDiameter: px(inner.width)
                * Number.parseFloat(root.getPropertyValue('--live-marker-inner-start-scale')),
            left: Number.parseFloat(element.style.left),
            outerDiameter: px(outer.width),
            outerMinimumDiameter: px(outer.width)
                * Number.parseFloat(root.getPropertyValue('--live-marker-outer-start-scale')),
            ringBorderWidth: px(outer.borderTopWidth),
            top: Number.parseFloat(element.style.top),
            expectedLeft: chart.scales.x.getPixelForValue(lastIndex),
            expectedTop: chart.scales.y.getPixelForValue(lastValue),
        };
    });
    expect(markerState.animation).toBe('live-marker-breath');
    expect(markerState.coreSize).toBe(6);
    expect(markerState.duration).toBe('1.8s');
    expect(markerState.innerDelay).toBe('0.9s');
    expect(markerState.innerDiameter).toBe(16);
    expect(markerState.innerMinimumDiameter).toBe(6);
    expect(markerState.outerDiameter).toBe(24);
    expect(markerState.outerMinimumDiameter).toBe(6);
    expect(markerState.ringBorderWidth).toBe(2);
    expect(Math.abs(markerState.left - markerState.expectedLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(markerState.top - markerState.expectedTop)).toBeLessThanOrEqual(0.5);

    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect.poll(() => marker.evaluate((element) => {
        const outer = getComputedStyle(element, '::before');
        const inner = getComputedStyle(element, '::after');
        return {
            innerAnimation: inner.animationName,
            innerOpacity: Number.parseFloat(inner.opacity),
            outerAnimation: outer.animationName,
            outerOpacity: Number.parseFloat(outer.opacity),
        };
    })).toEqual({
        innerAnimation: 'none',
        innerOpacity: 0.42,
        outerAnimation: 'none',
        outerOpacity: 0,
    });
});

test('marks Investment Holdings with Longbridge overnight quotes', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-28T03:30:00Z').valueOf();
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
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-27',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 10,
                price: 52.43,
                amount: -524.30,
            },
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-24', close: 53.20},
                {date: '2026-07-27', close: 52.43},
            ],
        },
        realtimeQuotes: [{
            ticker: 'DRAM',
            price: 49.40,
            timestamp: '2026-07-27 23:30',
            session: 'overnight',
            session_date: '2026-07-28',
            market: 'US',
            source: 'longbridge',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-28',
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const holdingRow = page.locator(
        '#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="DRAM"]',
    );
    const lastPrice = holdingRow.locator('[data-investment-live-field="last"]');
    const unrealizedPnl = holdingRow.locator('[data-investment-live-field="unrealized_pnl"]');
    await expect(lastPrice).toHaveAttribute('data-investment-live-number', '49.4');
    await expect(lastPrice).toHaveAttribute('data-investment-live-display', '49.40');
    await expect(unrealizedPnl).toHaveAttribute('data-investment-live-display', '-30.30');

    const liveSummary = await page.evaluate(() => {
        const read = (field) => Number(
            document.querySelector(
                `#investment_holdings_panel [data-investment-live-field="${field}"]`,
            )?.dataset.investmentLiveNumber,
        );
        return {
            cash: read('summary_cash_balance'),
            marketValue: read('summary_market_value'),
            totalEquity: read('summary_total_equity'),
        };
    });
    expect(liveSummary.totalEquity).toBeCloseTo(
        liveSummary.cash + liveSummary.marketValue,
        8,
    );
});

test('keeps the realtime equity endpoint aligned with cash-equivalent Holdings', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-28T03:30:00Z').valueOf();
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
    await mockInvestmentReadApis(page, {
        transactions: [{
            ledger_no: 1,
            broker: 'hsbc',
            date: '2026-07-27',
            type: 'buy',
            ticker: 'SGOV',
            currency: 'USD',
            quantity: 1,
            price: 100.58,
            amount: -100.58,
        }],
        moneyMarketTickers: [],
        cashEquivalentTickers: ['SGOV'],
        priceHistoryByTicker: {
            SGOV: [{date: '2026-07-27', close: 100.58}],
        },
        realtimeQuotes: [{
            ticker: 'SGOV',
            price: 100.50,
            timestamp: '2026-07-27 23:30',
            session: 'overnight',
            session_date: '2026-07-28',
            market: 'US',
            source: 'longbridge',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-28',
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();
    const holdingRow = page.locator(
        '#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="SGOV"]',
    );
    await expect(holdingRow.locator('[data-investment-live-field="last"]')).toHaveAttribute(
        'data-investment-live-number',
        '100.5',
    );

    const endpoint = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const chartValues = chart?.data?.datasets?.[0]?.data || [];
        const holdingsTotal = Number(document.querySelector(
            '#investment_holdings_panel [data-investment-live-field="summary_total_equity"]',
        )?.dataset.investmentLiveNumber);
        return {
            chartTotal: Number(chartValues.at(-1)),
            holdingsTotal,
        };
    });
    expect(endpoint.chartTotal).toBeCloseTo(endpoint.holdingsTotal, 8);
});

test('keeps same-day HSBC USD settlement proceeds after earlier buys', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-30',
                datetime: '2026-06-30 19:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 20_000,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-01',
                datetime: '2026-07-01 19:00:00',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-01-JUL-BUY',
                    cash_settlement_date: '2026-07-02',
                    cash_settlement_amount_raw: '-100.00',
                    cash_settlement_balance_after_raw: '19900.00',
                    cash_settlement_postings: [{
                        date: '2026-07-02',
                        amount_raw: '-100.00',
                        balance_after_raw: '19900.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 101,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-01',
                datetime: '2026-07-01 20:00:00',
                type: 'sell',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: 100,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-01-JUL-SELL',
                    cash_settlement_date: '2026-07-02',
                    cash_settlement_amount_raw: '100.00',
                    cash_settlement_balance_after_raw: '20000.00',
                    cash_settlement_postings: [{
                        date: '2026-07-02',
                        amount_raw: '100.00',
                        balance_after_raw: '20000.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 102,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-30', close: 100},
                {date: '2026-07-01', close: 100},
                {date: '2026-07-02', close: 100},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    // The later same-day sale boundary must remain the final cash state.
    expect(chartValues.find((point) => point.date === '2026-07-02')?.value).toBeCloseTo(20_000, 8);
});

test('recovers same-day HSBC settlement order from authoritative balance continuity', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-31',
                datetime: '2026-08-31 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 33_222.32,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-01',
                datetime: '2026-09-01 20:00:00',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 10,
                price: 23,
                amount: -230,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-119045',
                    cash_settlement_date: '2026-09-02',
                    cash_settlement_amount_raw: '-230.00',
                    cash_settlement_balance_after_raw: '32992.32',
                    cash_settlement_postings: [{
                        date: '2026-09-02',
                        amount_raw: '-230.00',
                        balance_after_raw: '32992.32',
                        source_file_kind: 'hsbc_usd_account_text',
                        ledger_sequence: 47,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-09-01',
                datetime: '2026-09-01 20:00:01',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 100,
                price: 118.07,
                amount: -11_807,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-742284',
                    cash_settlement_date: '2026-09-02',
                    cash_settlement_amount_raw: '-11807.00',
                    cash_settlement_balance_after_raw: '21185.32',
                    cash_settlement_postings: [{
                        date: '2026-09-02',
                        amount_raw: '-11807.00',
                        balance_after_raw: '21185.32',
                        source_file_kind: 'hsbc_usd_account_text',
                        ledger_sequence: 43,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
        ],
        priceHistoryByTicker: {
            EUV: [
                {date: '2026-09-01', close: 23},
                {date: '2026-09-02', close: 23},
            ],
            BOXX: [
                {date: '2026-09-01', close: 118.07},
                {date: '2026-09-02', close: 118.07},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    expect(chartValues.find((point) => point.date === '2026-09-02')?.value).toBeCloseTo(33_222.32, 8);
});

test('replays future HSBC settlement cash on the settlement date without a derived transaction', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-05-30',
                type: 'withdrawal',
                currency: 'USD',
                amount: 0,
                description: 'Legacy USD balance snapshot',
                source: {
                    account_type: 'Foreign Currency Savings USD',
                    balance_after_raw: '0.00',
                    file_kind: 'hsbc_statement_cash',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-05-31',
                type: 'withdrawal',
                currency: 'USD',
                amount: -24_373.75,
                description: 'Unscoped historical USD replay delta',
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 1000,
                net_amount_raw: '1000.00',
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    row_number: 104,
                    ledger_sequence: 104,
                    cash_balance_authoritative: true,
                    balance_after_raw: '11000.00',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 21:00:00',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 900,
                amount: -900,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-TEST',
                    // Matched SEC evidence clears the provisional pending flag.
                    // Trade-date equity must remain correct without that flag.
                    cash_settlement_date: '2026-06-23',
                    cash_settlement_amount_raw: '-900.00',
                    cash_settlement_balance_after_raw: '10600.00',
                    cash_settlement_reference: 'REF PTEST001 SEC',
                    cash_settlement_source_row_number: 102,
                    cash_settlement_postings: [{
                        date: '2026-06-23',
                        amount_raw: '-900.00',
                        balance_after_raw: '10600.00',
                        reference: 'REF PTEST001 SEC',
                        row_number: 102,
                        ledger_sequence: 102,
                        source_file_kind: 'hsbc_usd_savings_csv',
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-23',
                datetime: '2026-06-23 20:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 500,
                net_amount_raw: '500.00',
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    row_number: 101,
                    ledger_sequence: 101,
                    cash_balance_authoritative: true,
                    balance_after_raw: '11500.00',
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-22', close: 1000},
                {date: '2026-06-23', close: 1000},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    // The order-day equity includes the signed settlement payable: settled
    // cash 11,000 - payable 900 + BOXX market value 1,000.
    expect(chartValues.find((point) => point.date === '2026-06-22')?.value).toBeCloseTo(11100, 8);
    expect(chartValues.find((point) => point.date === '2026-06-23')?.value).toBeCloseTo(11600, 8);
    const settledOrderRow = page.locator('#investment_history_row_2');
    await expect(settledOrderRow.locator('td').nth(9)).not.toContainText('*');
    await expect(settledOrderRow.locator('td').nth(10)).not.toContainText('*');
    await expect(
        page.locator('#investment_history .investment-history-cell-left')
            .filter({hasText: 'BOXX @ 900.00 × 1'})
            .first(),
    ).toHaveText('BOXX @ 900.00 × 1 · P-TEST');
    await expect(page.getByText('HSBC cash settlement replay', {exact: true})).toHaveCount(0);
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(5);
});

test('keeps overlapping HSBC trade-date payables continuous across 22–24 Jun 2026', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 19:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 20_000,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-22',
                datetime: '2026-06-22 20:00:00',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 17_112.34,
                amount: -17_112.34,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-22-JUN',
                    cash_settlement_date: '2026-06-23',
                    cash_settlement_amount_raw: '-17112.34',
                    cash_settlement_balance_after_raw: '20246.55',
                    cash_settlement_postings: [{
                        date: '2026-06-23',
                        amount_raw: '-17112.34',
                        balance_after_raw: '20246.55',
                        source_file_kind: 'hsbc_statement_cash',
                        ledger_sequence: 220,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-23',
                datetime: '2026-06-23 19:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 7_358.89,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-23',
                datetime: '2026-06-23 20:00:00',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 1,
                price: 1_844.80,
                amount: -1_844.80,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-23-JUN',
                    cash_settlement_date: '2026-06-24',
                    cash_settlement_amount_raw: '-1844.80',
                    cash_settlement_balance_after_raw: '18401.75',
                    cash_settlement_postings: [{
                        date: '2026-06-24',
                        amount_raw: '-1844.80',
                        balance_after_raw: '18401.75',
                        source_file_kind: 'hsbc_statement_cash',
                        ledger_sequence: 230,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-22', close: 17_112.34},
                {date: '2026-06-23', close: 17_112.34},
                {date: '2026-06-24', close: 17_112.34},
            ],
            EUV: [
                {date: '2026-06-23', close: 1_844.80},
                {date: '2026-06-24', close: 1_844.80},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    expect(chartValues.find((point) => point.date === '2026-06-22')?.value).toBeCloseTo(30_000, 8);
    expect(chartValues.find((point) => point.date === '2026-06-23')?.value).toBeCloseTo(37_358.89, 8);
    expect(chartValues.find((point) => point.date === '2026-06-24')?.value).toBeCloseTo(37_358.89, 8);
});

test('anchors HSBC History cash to an evidenced future SEC settlement balance', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-05',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
                source: {
                    file_kind: 'hsbc_usd_account_text',
                    balance_after_raw: '13000.00',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-06',
                type: 'sell',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 2,
                price: 52.35,
                amount: 104.69,
                source: {
                    cash_replay_pending_settlement: true,
                    cash_settlement_date: '2026-08-07',
                    cash_settlement_amount_raw: '104.69',
                    cash_settlement_balance_after_raw: '20976.10',
                    cash_flow_fee_amount_raw: '0.01',
                    cash_settlement_reference: 'REF S900040001 SEC',
                },
            },
        ],
        priceHistoryByTicker: {
            DRAM: [{date: '2026-08-06', close: 52.35}],
        },
    });
    await page.goto('/trade/investment?range=max');

    const sellRow = page.locator('#investment_history_row_2');
    await expect(sellRow.locator('td').nth(9)).toContainText('20,976.10');
    await expect(sellRow.locator('td').nth(9)).not.toContainText('*');
});

test('renders one visible marker for one unsettled HSBC EUV sale', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [{
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-09-21',
            type: 'sell',
            ticker: 'EUV',
            currency: 'USD',
            quantity: 5,
            price: 24.15,
            amount: 120.75,
            source: {
                file_kind: 'hsbc_order_status_text',
                cash_replay_pending_settlement: true,
                order_id: 'S-657689',
                statement_order_id: 'S-657689',
            },
        }],
        summary: {
            authoritative_current_cash_brokers: ['hsbc'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                account_id: 'HSBC-TEST',
                cash_snapshot_authoritative: true,
                ending_cash_base_currency: '21779.45',
                ending_cash_by_currency: {USD: '21779.45'},
                hsbc_pending_settlement_cash: '120.750',
                hsbc_broker_cash_estimate: '21900.200',
                position_snapshot_as_of: '2026-09-21',
            },
        },
        priceHistoryByTicker: {
            EUV: [{date: '2026-09-21', close: 24.15}],
        },
    });
    await page.goto('/trade/investment');

    const sellRow = page.locator('#investment_history_row_1');
    await expect(sellRow).toContainText('EUV @ 24.15 × 5 · S-657689*');
    await expect(sellRow.locator('td').nth(9)).not.toContainText('*');
    await expect(sellRow.locator('td').nth(10)).not.toContainText('*');
    await expect.poll(() => page.locator('#investment_history').evaluate((body) => (
        body.innerText.match(/\*/g) || []
    ).length)).toBe(1);
});

test('keeps HSBC unsettled buy history sequential while current cash stays current', async ({page}) => {
    const pendingBuys = [
        ['DRAM', 5, 57.00, 285.00],
        ['EUV', 1, 25.75, 25.75],
        ['EUV', 1, 25.70, 25.70],
        ['DRAM', 1, 55.75, 55.75],
        ['EUV', 1, 25.50, 25.50],
        ['DRAM', 1, 55.00, 55.00],
        ['QQQI', 5, 55.14, 275.70],
        ['EUV', 1, 25.50, 25.50],
        ['DRAM', 3, 55.00, 165.00],
    ];
    const transactions = [
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-08-18',
            datetime: '2026-08-17 08:00:00',
            type: 'sell',
            currency: 'USD',
            ticker: 'DRAM',
            quantity: 1,
            price: 1000,
            amount: 1000,
            source: {
                cash_settlement_date: '2026-08-20',
                cash_settlement_amount_raw: '1000.00',
                cash_settlement_balance_after_raw: '13231.60',
                cash_settlement_postings: [{
                    date: '2026-08-20',
                    amount_raw: '1000.00',
                    balance_after_raw: '13231.60',
                    currency: 'USD',
                    role: 'principal',
                }],
                order_id: 'S-TEST-1',
            },
        },
        ...pendingBuys.map(([ticker, quantity, price, amount], index) => ({
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-08-18',
            datetime: `2026-08-18 ${String(9 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00`,
            type: 'buy',
            ticker,
            currency: 'USD',
            quantity,
            price,
            amount: -amount,
            source: {
                cash_replay_pending_settlement: true,
                order_id: `P-TEST-${index + 1}`,
            },
        })),
    ];
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions,
        summary: {
            authoritative_current_cash_brokers: ['hsbc'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                account_id: 'HSBC-TEST',
                cash_snapshot_authoritative: true,
                ending_cash_base_currency: '23413.41',
                ending_cash_by_currency: {USD: '23413.41'},
                hsbc_pending_settlement_cash: '-938.900',
                hsbc_broker_cash_estimate: '22474.510',
                position_snapshot_as_of: '2026-08-18',
            },
        },
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-08-17', close: 1000.00},
                {date: '2026-08-18', close: 55.00},
            ],
            EUV: [{date: '2026-08-18', close: 25.50}],
            QQQI: [{date: '2026-08-18', close: 55.14}],
        },
    });
    await page.goto('/trade/investment');

    const firstBuyRow = page.locator('#investment_history_row_2');
    const latestBuyRow = page.locator('#investment_history_row_10');
    // The fixture's authoritative cash is 23,413.41. Apply the first pending
    // buy (-285.00), then all pending buys (-938.90), without replaying the
    // older 3,231.60 settlement correction on top of that cash anchor.
    await expect(firstBuyRow.locator('td').nth(9)).toContainText('23,128.41');
    await expect(firstBuyRow.locator('td').nth(9)).not.toContainText('*');
    await expect(latestBuyRow.locator('td').nth(9)).toContainText('22,474.51');
    await expect(latestBuyRow.locator('td').nth(9)).not.toContainText('*');
    await expect(
        page.locator('#investment_history .investment-history-cell-left')
            .filter({hasText: 'DRAM @ 57.00 × 5'})
            .first(),
    ).toHaveText('DRAM @ 57.00 × 5 · P-TEST-1*');

    await page.locator('label[for="investment_view_holdings"]').click();
    const currentCash = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]',
    );
    await expect(currentCash).toHaveAttribute('data-investment-live-display', '22,474.51');
});
