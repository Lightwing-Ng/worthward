/* Code version: v1.0.1 */
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
test('keeps ticker identity visible and range pills interactive on price performance', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1y');

    const identityStates = await page.locator('.ticker-input-control').evaluateAll((controls) => controls.map((control) => {
        const logo = control.querySelector('.ticker-input-logo');
        const placeholder = control.querySelector('.ticker-logo-placeholder');
        return {
            logoVisible: logo instanceof HTMLImageElement && !logo.hidden && logo.naturalWidth > 0,
            fallbackVisible: placeholder instanceof HTMLElement && !placeholder.hidden && Boolean(placeholder.textContent.trim()),
        };
    }));
    expect(identityStates.every((state) => state.logoVisible || state.fallbackVisible)).toBe(true);

    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    await expect(page.locator('#range_exact')).toBeChecked();
    await expect(page.locator('#exact_panel')).toBeVisible();
    await page.locator('.range-mode-shell label[for="range_period"]').click();
    await expect(page.locator('#range_period')).toBeChecked();
    await expect(page.locator('#period_panel')).toBeVisible();
});

test('switches the Ticker comparison metric at the requested sidebar position', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&period=1y');

    const marketCapResponse = await page.request.get(
        '/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA',
    );
    expect(marketCapResponse.ok()).toBe(true);
    const marketCapHtml = await marketCapResponse.text();

    const metricField = page.locator('xpath=/html/body/main/div/section/section/div/aside/form/div[3]');
    await expect(metricField).toHaveAttribute('data-comparison-metric-field', '');
    const placement = await metricField.evaluate((field) => ({
        previousId: field.previousElementSibling?.id || '',
        nextClasses: field.nextElementSibling?.className || '',
    }));
    expect(placement).toEqual({
        previousId: 'ticker_add_wrapper',
        nextClasses: expect.stringContaining('range-mode-field'),
    });

    const metricSwitch = metricField.locator('[data-comparison-metric-switch]');
    const priceMetric = metricSwitch.locator('[data-comparison-metric-input][value="price"]');
    const marketCapMetric = metricSwitch.locator('[data-comparison-metric-input][value="market-cap"]');
    await expect(priceMetric).toBeChecked();
    await expect(marketCapMetric).not.toBeChecked();
    const pricePillColor = await metricSwitch.evaluate((element) => getComputedStyle(element, '::before').backgroundColor);
    const priceSelectedLabelColor = await metricSwitch.locator('label[for="comparison_metric_price"] span').evaluate(
        (label) => getComputedStyle(label).color,
    );
    expect(pricePillColor).toBe('rgb(0, 85, 204)');
    expect(await page.evaluate(() => window.WORTHWARD_APP.constraints.maxTickers)).toBe(5);

    await page.evaluate(() => {
        window.__priceMetricForm = document.querySelector('form.controls');
    });
    const navigationEntryCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);

    await page.route('**/workspaces/prices?*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/workspaces/prices' && url.searchParams.get('metric') === 'market-cap') {
            await new Promise((resolve) => setTimeout(resolve, 900));
            await route.fulfill({status: 200, contentType: 'text/html', body: marketCapHtml});
            return;
        }
        await route.continue();
    });

    await metricSwitch.locator('label[for="comparison_metric_market_cap"]').click();

    await expect(marketCapMetric).toBeChecked();
    await expect(metricSwitch).toHaveAttribute('data-active', 'market-cap');
    await expect(page.locator('#workspace_modal_overlay')).toBeVisible();
    await expect(page.locator('#workspace_modal_overlay .workspace-modal-title')).toHaveText(
        'Calculating market-cap history',
    );
    await expect(page.getByRole('heading', {name: 'Price history', exact: true, level: 2})).toBeVisible();
    expect(await metricSwitch.evaluate((element) => getComputedStyle(element, '::before').backgroundColor)).toBe(
        'rgb(0, 85, 204)',
    );
    await expect.poll(() => metricSwitch.locator('label[for="comparison_metric_market_cap"] span').evaluate(
        (label) => getComputedStyle(label).color,
    )).toBe(priceSelectedLabelColor);

    await expect(page).toHaveURL(/metric=market-cap/);
    await expect(page.getByRole('heading', {name: 'Market cap history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect(page.locator('[data-chips-field]')).toBeHidden();
    await expect(page.locator('[data-chips-input]')).toBeDisabled();
    expect(await page.evaluate(() => window.WORTHWARD_APP.constraints.maxTickers)).toBe(10);
    expect(await page.evaluate(() => document.querySelector('form.controls') === window.__priceMetricForm)).toBe(true);
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navigationEntryCount);

    const marketCapUrl = new URL(page.url());
    expect(marketCapUrl.searchParams.get('metric')).toBe('market-cap');
    expect(marketCapUrl.searchParams.getAll('ticker')).toEqual(['AAPL', 'NVDA']);
    expect(marketCapUrl.searchParams.has('period')).toBe(false);
});

test('places the Ticker comparison mode above Period and Position distribution below Period', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&period=1y');

    const periodPanel = page.locator('#period_panel');
    const rangeModeField = page.locator('.range-mode-field');
    const chipsField = page.locator('[data-chips-field]');
    await expect(periodPanel).toBeVisible();
    await expect(rangeModeField).toBeVisible();
    await expect(chipsField).toBeVisible();
    await expect(chipsField.locator('.switch-label')).toHaveText('Position distribution');

    const placement = await rangeModeField.evaluate((field) => {
        const form = field.parentElement;
        const period = form?.querySelector('#period_panel');
        const chips = form?.querySelector('[data-chips-field]');
        const children = form ? Array.from(form.children) : [];
        return {
            modeIndex: children.indexOf(field),
            periodIndex: period ? children.indexOf(period) : -1,
            chipsIndex: chips ? children.indexOf(chips) : -1,
            modeNextId: field.nextElementSibling?.id || '',
        };
    });
    expect(placement.modeIndex).toBeLessThan(placement.periodIndex);
    expect(placement.periodIndex).toBeLessThan(placement.chipsIndex);
    expect(placement.modeNextId).toBe('period_panel');
});

test('keeps the Ticker comparison range Mode content-sized and centered', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&period=1y');

    const periodTrigger = page.locator(
        'xpath=/html/body/main/div/section/section/div/aside/form/div[5]/div/div[1]/button',
    );
    const rangeMode = page.locator(
        'xpath=/html/body/main/div/section/section/div/aside/form/div[4]/div',
    );
    await expect(periodTrigger).toBeVisible();
    await expect(rangeMode).toBeVisible();

    const readRangeModeGeometry = () => rangeMode.evaluate((element) => {
        const owner = element.closest('.range-mode-field') || element.parentElement;
        const controlRect = element.getBoundingClientRect();
        const ownerRect = owner?.getBoundingClientRect();
        const optionWidths = Array.from(element.querySelectorAll('.segmented-control-option'))
            .map((option) => option.getBoundingClientRect().width);
        return {
            centerDelta: ownerRect
                ? Math.abs((controlRect.left + (controlRect.width / 2)) - (ownerRect.left + (ownerRect.width / 2)))
                : Number.POSITIVE_INFINITY,
            compact: ownerRect ? controlRect.width < ownerRect.width - 1 : false,
            optionWidths,
        };
    });
    for (const geometry of [await readRangeModeGeometry()]) {
        expect(geometry.compact).toBe(true);
        expect(geometry.centerDelta).toBeLessThanOrEqual(1);
        expect(Math.max(...geometry.optionWidths) - Math.min(...geometry.optionWidths)).toBeLessThanOrEqual(1);
    }

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    const controlsToggle = page.locator('[data-workspace-controls-toggle]');
    await expect(controlsToggle).toBeVisible();
    await controlsToggle.click();
    await expect(page.locator('[data-workspace-controls-panel]')).toBeVisible();
    await expect(periodTrigger).toBeVisible();
    await expect(rangeMode).toBeVisible();
    for (const geometry of [await readRangeModeGeometry()]) {
        expect(geometry.compact).toBe(true);
        expect(geometry.centerDelta).toBeLessThanOrEqual(1);
        expect(Math.max(...geometry.optionWidths) - Math.min(...geometry.optionWidths)).toBeLessThanOrEqual(1);
    }
});

test('renders a cached OHLCV cost distribution on the price scale without category legends', async ({page}) => {
    let fallbackRequests = 0;
    await page.route('**/api/compare/chips**', async (route) => {
        fallbackRequests += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: [],
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=NVDA&ticker=MU&ticker=AMD&period=1y');
    const serverOhlcv = await page.evaluate(() => window.WORTHWARD_APP.chart.series.map((item) => ({
        ticker: item.ticker,
        rows: Array.isArray(item.ohlcv) ? item.ohlcv.length : 0,
        positiveVolumeRows: Array.isArray(item.ohlcv)
            ? item.ohlcv.filter((row) => Number(row.v) > 0).length
            : 0,
    })));
    expect(serverOhlcv.map((item) => item.ticker)).toEqual(['AAPL', 'NVDA', 'MU', 'AMD']);
    expect(
        serverOhlcv.every((item) => item.rows > 80 && item.positiveVolumeRows > 80),
        JSON.stringify(serverOhlcv),
    ).toBe(true);
    await page.evaluate(() => {
        window.WORTHWARD_APP.chart.series.forEach((item, itemIndex) => {
            const start = Date.UTC(2026, 4, 1);
            const basePrice = 100 + (itemIndex * 100);
            const rows = Array.from({length: 90}, (_, rowIndex) => {
                const isHighVolumePhase = rowIndex >= 45 && rowIndex < 75;
                const phaseOffset = rowIndex < 45 ? 0 : (isHighVolumePhase ? 70 : 20);
                const center = basePrice
                    + phaseOffset
                    + ((rowIndex % 45) * 0.11)
                    + (Math.sin(rowIndex / 5) * 5);
                const timestamp = new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10);
                return {
                    t: `${timestamp} 00:00`,
                    o: center - 1.2,
                    h: center + 4.2,
                    l: center - 4.4,
                    c: center + 1.1,
                    v: (isHighVolumePhase ? 900_000 : 100_000) + ((rowIndex % 11) * 35_000),
                    synthetic: false,
                };
            });
            item.ohlcv = rows;
            item.raw_dates = rows.map((row) => row.t);
            item.dates = rows.map((row) => row.t.slice(0, 10));
            item.prices = rows.map((row) => row.c);
            item.normalized_returns = rows.map((row) => ((row.c / rows[0].o) - 1) * 100);
            item.candlestick_prices = null;
        });
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
    });
    const chipsInput = page.locator('#show_chips');
    await expect(chipsInput).toBeVisible();
    await expect(chipsInput).not.toBeChecked();
    await expect(page.getByRole('heading', {name: 'Price history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('[data-price-chart-region]')).toBeVisible();
    await expect(page.locator('[data-chips-chart-region]')).toHaveAttribute('hidden');

    const revealStart = await chipsInput.evaluate((input) => {
        const readLogoPositions = () => [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .map((canvas) => window.Chart.getChart(canvas)?.$closingLogoPosition || null);
        const before = readLogoPositions();
        input.click();
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        return {
            before,
            after: canvases.map((canvas) => {
                const chart = window.Chart.getChart(canvas);
                return {
                    state: canvas.dataset.chipRevealState,
                    motion: canvas.dataset.chipRevealMotion,
                    logoMotion: canvas.dataset.chipLogoMotion,
                    profileProgress: Number(canvas.dataset.chipRevealProgress),
                    logoProgress: Number(canvas.dataset.chipLogoProgress),
                    logo: chart?.$chipRevealMotion || null,
                };
            }),
        };
    });
    expect(revealStart.before).toHaveLength(4);
    expect(revealStart.before.every(Boolean)).toBe(true);
    expect(revealStart.after).toHaveLength(4);
    expect(revealStart.after.every((item) => item.state === 'running')).toBe(true);
    expect(revealStart.after.every((item) => item.motion === 'shared-bouncy-spring')).toBe(true);
    expect(revealStart.after.every((item) => item.logoMotion === 'price-close-to-panel-top-right')).toBe(true);
    expect(revealStart.after.every((item) => item.profileProgress === 0 && item.logoProgress === 0)).toBe(true);
    revealStart.after.forEach((item, index) => {
        expect(item.logo.active).toBe(true);
        expect(item.logo.current.x).toBeCloseTo(item.logo.from.x, 4);
        expect(item.logo.current.y).toBeCloseTo(item.logo.from.y, 4);
        expect(item.logo.from.x).toBeCloseTo(revealStart.before[index].x, 4);
        expect(item.logo.from.y).toBeCloseTo(revealStart.before[index].y, 4);
        expect(item.logo.to.y).toBeLessThan(item.logo.from.y);
    });
    await expect.poll(async () => Number(
        await page.locator('[data-price-subplot-canvas]').first().getAttribute('data-chip-reveal-progress'),
    )).toBeGreaterThan(1);
    const jellyFrame = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const motion = window.Chart.getChart(canvas)?.$chipRevealMotion;
        return {
            state: canvas.dataset.chipRevealState,
            profileProgress: Number(canvas.dataset.chipRevealProgress),
            logoProgress: Number(canvas.dataset.chipLogoProgress),
            logo: motion,
        };
    });
    expect(jellyFrame.state).toBe('running');
    expect(jellyFrame.profileProgress).toBeGreaterThan(1);
    expect(jellyFrame.logoProgress).toBeLessThanOrEqual(1);
    expect(jellyFrame.logo.current.y).toBeGreaterThanOrEqual(jellyFrame.logo.to.y);
    expect(jellyFrame.logo.current.y).toBeLessThanOrEqual(jellyFrame.logo.from.y);
    await expect(chipsInput).toBeChecked();
    await expect(page).toHaveURL(/chips=1/);
    await expect(page.getByRole('heading', {name: 'Price history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('[data-price-chart-region]')).toBeVisible();
    await expect(page.locator('[data-chips-chart-region]')).not.toHaveAttribute('hidden');
    await expect(page.locator('[data-price-subplot-canvas][data-chip-distribution="1"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-cost-range-method="shortest-contiguous-high-density"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-bin-count="100"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-legend="0"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-baseline-line="none"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-current-price-line="hidden"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-hover-line="muted-solid"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-poc-style="price-relative-opacity"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-category-stack="none"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-color-model="price-relative"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-hover-marker="none"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-hover-marker-axis="none"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-logo-placement="panel-top-right"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-reveal-state="settled"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-reveal-progress="1.0000"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-logo-progress="1.0000"]')).toHaveCount(4);
    await expect(page.locator('[data-chips-chart-canvas]')).toHaveCount(0);
    expect(fallbackRequests).toBe(0);

    const fullRangePocs = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => Number(canvas.dataset.chipPocPrice))
    ));
    const historicalHoverPoint = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const chart = window.Chart.getChart(canvas);
        const rect = canvas.getBoundingClientRect();
        const item = window.WORTHWARD_APP.chart.series[0];
        const dataIndex = 30;
        return {
            dataIndex,
            x: rect.left + (chart.scales.x.getPixelForValue(dataIndex) * (rect.width / chart.width)),
            y: rect.top + (chart.scales.y.getPixelForValue(item.prices[dataIndex]) * (rect.height / chart.height)),
            outsideX: rect.left + 4,
            outsideY: Math.max(0, rect.top - 8),
        };
    });
    await page.mouse.move(historicalHoverPoint.x, historicalHoverPoint.y);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-snapshot-mode="cumulative-hover"]')).toHaveCount(4);
    await expect(page.locator(`[data-price-subplot-canvas][data-chip-snapshot-index="${historicalHoverPoint.dataIndex}"]`)).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-snapshot-rows="31"]')).toHaveCount(4);
    const historicalSnapshots = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => {
            const chart = window.Chart.getChart(canvas);
            return {
                date: canvas.dataset.chipSnapshotDate,
                poc: Number(canvas.dataset.chipPocPrice),
                cacheSize: chart.$costDistributionContext.snapshots.size,
                totalWeight: chart.$costDistribution.distribution.totalWeight,
            };
        })
    ));
    historicalSnapshots.forEach((snapshot, index) => {
        expect(snapshot.date).toBe('2026-05-31 00:00');
        expect(snapshot.poc).toBeLessThan(fullRangePocs[index] - 40);
        expect(snapshot.totalWeight).toBeGreaterThan(0);
        expect(snapshot.cacheSize).toBe(1);
    });

    await page.mouse.move(historicalHoverPoint.x, historicalHoverPoint.y + 4);
    await expect.poll(() => page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => (
        window.Chart.getChart(canvas).$costDistributionContext.snapshots.size
    ))).toBe(1);

    const laterHoverPoint = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const chart = window.Chart.getChart(canvas);
        const rect = canvas.getBoundingClientRect();
        const item = window.WORTHWARD_APP.chart.series[0];
        const dataIndex = 70;
        return {
            dataIndex,
            x: rect.left + (chart.scales.x.getPixelForValue(dataIndex) * (rect.width / chart.width)),
            y: rect.top + (chart.scales.y.getPixelForValue(item.prices[dataIndex]) * (rect.height / chart.height)),
        };
    });
    await page.mouse.move(laterHoverPoint.x, laterHoverPoint.y);
    await expect(page.locator(`[data-price-subplot-canvas][data-chip-snapshot-index="${laterHoverPoint.dataIndex}"]`)).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-snapshot-rows="71"]')).toHaveCount(4);
    const laterPocs = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => Number(canvas.dataset.chipPocPrice))
    ));
    laterPocs.forEach((poc, index) => {
        expect(poc).toBeGreaterThan(historicalSnapshots[index].poc + 40);
    });

    await page.mouse.move(historicalHoverPoint.outsideX, historicalHoverPoint.outsideY);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-snapshot-mode="full-range"]')).toHaveCount(4);
    const restoredPocs = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => Number(canvas.dataset.chipPocPrice))
    ));
    restoredPocs.forEach((poc, index) => expect(poc).toBeCloseTo(fullRangePocs[index], 6));

    const chipGeometry = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const chart = window.Chart.getChart(canvas);
        const rect = canvas.getBoundingClientRect();
        const profile = chart.$costDistribution;
        const bins = profile.distribution.bins;
        const pocBin = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best);
        const alternateBin = bins
            .filter((bin) => bin.weight > 0 && bin.index !== pocBin.index)
            .reduce((best, bin) => !best || bin.normalizedWidth < best.normalizedWidth ? bin : best, null);
        const panelLeft = chart.chartArea.right + 10;
        const panelRight = chart.width - 8;
        const chartToCssX = rect.width / chart.width;
        const chartToCssY = rect.height / chart.height;
        const pocY = profile.priceToCanvasY(pocBin.price);
        return {
            hoverX: rect.left + ((panelLeft + Math.max(2, ((panelRight - panelLeft) * pocBin.normalizedWidth * 0.5))) * chartToCssX),
            hoverY: rect.top + (pocY * chartToCssY),
            alternateHoverX: rect.left + ((panelLeft + 4) * chartToCssX),
            alternateHoverY: rect.top + (profile.priceToCanvasY(alternateBin.price) * chartToCssY),
            outsideHoverX: rect.left + 4,
            outsideHoverY: Math.max(0, rect.top - 8),
            normalizedWidth: pocBin.normalizedWidth,
            pocPrice: pocBin.price,
            reportedPocPrice: profile.statistics.pocPrice,
            pocY,
            directScaleY: chart.scales.y.getPixelForValue(pocBin.price),
            panelLeft,
            chartAreaRight: chart.chartArea.right,
            panelRight,
            chartWidth: chart.width,
            chartDevicePixelRatio: chart.currentDevicePixelRatio,
            windowDevicePixelRatio: window.devicePixelRatio,
            backingWidth: canvas.width,
            cssWidth: rect.width,
        };
    });
    expect(chipGeometry.normalizedWidth).toBe(1);
    expect(chipGeometry.pocPrice).toBe(chipGeometry.reportedPocPrice);
    expect(chipGeometry.pocY).toBe(chipGeometry.directScaleY);
    expect(chipGeometry.panelLeft).toBeGreaterThan(chipGeometry.chartAreaRight);
    expect(chipGeometry.panelRight).toBeLessThanOrEqual(chipGeometry.chartWidth);
    expect(chipGeometry.chartDevicePixelRatio).toBe(chipGeometry.windowDevicePixelRatio);
    expect(chipGeometry.backingWidth).toBeGreaterThanOrEqual(chipGeometry.cssWidth * chipGeometry.windowDevicePixelRatio - 1);

    const firstChipCanvas = page.locator('[data-price-subplot-canvas]').first();
    const idleGuideStrokes = await recordCostDistributionGuideStrokes(firstChipCanvas);
    expect(idleGuideStrokes).not.toBeNull();
    expect(idleGuideStrokes.baselineCount).toBe(0);
    expect(idleGuideStrokes.fullWidthHorizontalStrokes).toHaveLength(0);

    await page.mouse.move(chipGeometry.hoverX, chipGeometry.hoverY);
    await expect(page.locator('.price-shared-tooltip')).toBeVisible();
    await expect(page.locator('.price-shared-tooltip')).toContainText('Estimated concentration');
    await expect(page.locator('.price-shared-tooltip')).toContainText('POC');
    await expect(page.locator('.price-shared-tooltip')).toContainText('70% cost range');
    await expect(page.locator('.price-shared-tooltip')).toContainText('Position');
    await expect(page.locator('.price-shared-tooltip')).not.toContainText('Buy / Neutral / Sell');
    const chipTooltipLayout = await page.locator('.price-shared-tooltip').evaluate((tooltip) => {
        const tooltipRect = tooltip.getBoundingClientRect();
        const rows = [...tooltip.querySelectorAll('.chart-tooltip-row')].map((row) => {
            const label = row.querySelector('.chart-tooltip-label');
            const value = row.querySelector('.chart-tooltip-value');
            const labelRect = label.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            return {
                childCount: row.children.length,
                gridTemplateColumns: getComputedStyle(row).gridTemplateColumns,
                rowHeight: row.getBoundingClientRect().height,
                labelRight: labelRect.right,
                valueLeft: valueRect.left,
                valueHeight: valueRect.height,
            };
        });
        return {
            kind: tooltip.dataset.tooltipKind,
            placement: tooltip.dataset.tooltipPlacement,
            rect: {
                left: tooltipRect.left,
                top: tooltipRect.top,
                right: tooltipRect.right,
                bottom: tooltipRect.bottom,
                width: tooltipRect.width,
                height: tooltipRect.height,
            },
            rows,
        };
    });
    expect(chipTooltipLayout.kind).toBe('chip');
    expect(['above', 'below']).toContain(chipTooltipLayout.placement);
    expect(chipTooltipLayout.rows).toHaveLength(8);
    expect(chipTooltipLayout.rows.every((row) => row.childCount === 3)).toBe(true);
    expect(chipTooltipLayout.rows.every((row) => row.gridTemplateColumns.split(' ').length === 3)).toBe(true);
    expect(chipTooltipLayout.rows.every((row) => row.labelRight <= row.valueLeft)).toBe(true);
    expect(chipTooltipLayout.rows.every((row) => row.valueHeight <= row.rowHeight)).toBe(true);
    expect(chipTooltipLayout.rect.left).toBeGreaterThanOrEqual(0);
    expect(chipTooltipLayout.rect.right).toBeLessThanOrEqual(1280);
    const tooltipCursorGap = chipTooltipLayout.placement === 'above'
        ? chipGeometry.hoverY - chipTooltipLayout.rect.bottom
        : chipTooltipLayout.rect.top - chipGeometry.hoverY;
    expect(tooltipCursorGap).toBeGreaterThanOrEqual(12);
    expect(Math.abs(
        ((chipTooltipLayout.rect.left + chipTooltipLayout.rect.right) / 2) - chipGeometry.hoverX,
    )).toBeLessThanOrEqual(72);
    const hoveredGuideStrokes = await recordCostDistributionGuideStrokes(firstChipCanvas);
    expect(hoveredGuideStrokes.baselineCount).toBe(0);
    expect(hoveredGuideStrokes.fullWidthHorizontalStrokes).toHaveLength(1);
    expect(hoveredGuideStrokes.fullWidthHorizontalStrokes[0].y).toBeCloseTo(chipGeometry.pocY, 3);
    expect(hoveredGuideStrokes.fullWidthHorizontalStrokes[0].dash).toEqual([]);
    expect(hoveredGuideStrokes.fullWidthHorizontalStrokes[0].alpha).toBeCloseTo(0.56, 2);
    expect(hoveredGuideStrokes.fullWidthHorizontalStrokes[0].lineWidth).toBeLessThanOrEqual(1);

    const hoveredPriceMarker = await firstChipCanvas.evaluate((canvas) => (
        window.Chart.getChart(canvas)?.$chipHoverPriceMarker || null
    ));
    expect(hoveredPriceMarker).toBeNull();

    await page.mouse.move(chipGeometry.alternateHoverX, chipGeometry.alternateHoverY);
    await expect(page.locator('.price-shared-tooltip')).toBeVisible();
    const alternateTooltipRect = await page.locator('.price-shared-tooltip').evaluate((tooltip) => {
        const rect = tooltip.getBoundingClientRect();
        return {width: rect.width, height: rect.height};
    });
    expect(Math.abs(alternateTooltipRect.width - chipTooltipLayout.rect.width)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(alternateTooltipRect.height - chipTooltipLayout.rect.height)).toBeLessThanOrEqual(0.1);

    await page.mouse.move(chipGeometry.outsideHoverX, chipGeometry.outsideHoverY);
    await expect(page.locator('.price-shared-tooltip')).not.toHaveClass(/is-visible/);
    const fadingTooltipLayout = await page.locator('.price-shared-tooltip').evaluate((tooltip) => {
        const rect = tooltip.getBoundingClientRect();
        return {
            kind: tooltip.dataset.tooltipKind,
            width: rect.width,
            height: rect.height,
        };
    });
    expect(fadingTooltipLayout.kind).toBe('chip');
    expect(Math.abs(fadingTooltipLayout.width - chipTooltipLayout.rect.width)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(fadingTooltipLayout.height - chipTooltipLayout.rect.height)).toBeLessThanOrEqual(0.1);
    await expect.poll(async () => firstChipCanvas.evaluate((canvas) => (
        window.Chart.getChart(canvas)?.$chipHoverPriceMarker || null
    ))).toBeNull();

    const pocPrices = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => Number(canvas.dataset.chipPocPrice))
    ));
    expect(pocPrices[1]).toBeGreaterThan(pocPrices[0] + 80);

    const recalculatedPoc = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const previousPoc = Number(canvas.dataset.chipPocPrice);
        const item = window.WORTHWARD_APP.chart.series[0];
        item.ohlcv = item.ohlcv.map((row) => ({
            ...row,
            o: row.o + 30,
            h: row.h + 30,
            l: row.l + 30,
            c: row.c + 30,
        }));
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        return {previousPoc};
    });
    await expect(page.locator('[data-price-subplot-canvas]').first()).toHaveAttribute('data-chip-source', 'ohlcv-estimate');
    const nextPoc = Number(await page.locator('[data-price-subplot-canvas]').first().getAttribute('data-chip-poc-price'));
    expect(nextPoc).toBeGreaterThan(recalculatedPoc.previousPoc + 20);

    await page.setViewportSize({width: 390, height: 844});
    await expect(page.locator('[data-price-chart-region]')).toBeVisible();
    await expect(page.locator('[data-chips-chart-region]')).not.toHaveAttribute('hidden');
    const narrowChipLayout = await page.evaluate(() => {
        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')].map((canvas) => {
            const rect = canvas.getBoundingClientRect();
            return {left: rect.left, right: rect.right};
        });
        return {
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            canvases,
        };
    });
    expect(narrowChipLayout.documentWidth).toBeLessThanOrEqual(narrowChipLayout.viewportWidth);
    expect(narrowChipLayout.canvases.every(({left, right}) => left >= -1 && right <= narrowChipLayout.viewportWidth + 1)).toBe(true);

    await chipsInput.evaluate((input) => input.click());
    await expect(chipsInput).not.toBeChecked();
    await expect(page).not.toHaveURL(/chips=1/);
    await expect(page.getByRole('heading', {name: 'Price history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('[data-price-chart-region]')).toBeVisible();
    await expect(page.locator('[data-chips-chart-region]')).toHaveAttribute('hidden');
    await expect(page.locator('[data-price-subplot-canvas][data-chip-logo-placement="price-close"]')).toHaveCount(4);
});

test('animates the five-ticker chip profile and logos with the shared jelly motion', async ({page}) => {
    await page.route('**/api/compare/chips**', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: ['SPY', 'QQQ', 'MU', 'DRAM', 'SKHY'].map((ticker, index) => ({
                    ticker,
                    source: 'longbridge-trade-stats',
                    trades: [
                        {price: 100 + (index * 100), buy: 120, neutral: 80, sell: 40},
                        {price: 101 + (index * 100), buy: 90, neutral: 110, sell: 70},
                    ],
                })),
                errors: {},
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=SPY&ticker=QQQ&ticker=MU&ticker=DRAM&ticker=SKHY&range=6mo');
    const canvases = page.locator('[data-price-subplot-canvas]');
    await expect(canvases).toHaveCount(5);
    await expect.poll(() => canvases.evaluateAll((items) => items.every((canvas) => {
        const position = window.Chart.getChart(canvas)?.$closingLogoPosition;
        return Number.isFinite(position?.x) && Number.isFinite(position?.y);
    }))).toBe(true);
    const withoutChipsAlignment = await readPriceLogoThemeAlignment(page);
    expect(Number.isFinite(withoutChipsAlignment.themeCenterX)).toBe(true);
    expect(withoutChipsAlignment.logos).toHaveLength(5);
    expect(withoutChipsAlignment.logos.every((item) => (
        item.contract === 'global-theme-toggle-center'
        && item.clamped === '0'
        && Math.abs(item.delta) <= 0.1
    ))).toBe(true);

    const motionStart = await page.locator('#show_chips').evaluate((input) => {
        const before = [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .map((canvas) => window.Chart.getChart(canvas).$closingLogoPosition);
        input.click();
        return {
            before,
            after: [...document.querySelectorAll('[data-price-subplot-canvas]')].map((canvas) => {
                const chart = window.Chart.getChart(canvas);
                return {
                    state: canvas.dataset.chipRevealState,
                    profileProgress: Number(canvas.dataset.chipRevealProgress),
                    logoProgress: Number(canvas.dataset.chipLogoProgress),
                    motion: chart.$chipRevealMotion,
                };
            }),
        };
    });
    expect(motionStart.before).toHaveLength(5);
    expect(motionStart.after).toHaveLength(5);
    expect(motionStart.after.every((item) => (
        item.state === 'running'
        && item.profileProgress === 0
        && item.logoProgress === 0
    ))).toBe(true);
    motionStart.after.forEach((item, index) => {
        expect(item.motion.from.x).toBeCloseTo(motionStart.before[index].x, 4);
        expect(item.motion.from.y).toBeCloseTo(motionStart.before[index].y, 4);
        expect(item.motion.current.x).toBeCloseTo(item.motion.from.x, 4);
        expect(item.motion.current.y).toBeCloseTo(item.motion.from.y, 4);
        expect(item.motion.to.x).toBeCloseTo(item.motion.from.x, 4);
    });

    await expect.poll(async () => Number(
        await canvases.first().getAttribute('data-chip-reveal-progress'),
    )).toBeGreaterThan(1);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-reveal-state="settled"]')).toHaveCount(5);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-bin-count="100"]')).toHaveCount(5);
    const finalLogos = await canvases.evaluateAll((items) => items.map((canvas) => {
        const motion = window.Chart.getChart(canvas).$chipRevealMotion;
        return {
            current: motion.current,
            target: motion.to,
            profileProgress: Number(canvas.dataset.chipRevealProgress),
            logoProgress: Number(canvas.dataset.chipLogoProgress),
        };
    }));
    expect(finalLogos.every((item) => item.profileProgress === 1 && item.logoProgress === 1)).toBe(true);
    finalLogos.forEach((item) => {
        expect(item.current.x).toBeCloseTo(item.target.x, 4);
        expect(item.current.y).toBeCloseTo(item.target.y, 4);
    });
    const alignedLogoX = finalLogos.map((item) => item.current.x);
    expect(Math.max(...alignedLogoX) - Math.min(...alignedLogoX)).toBeLessThanOrEqual(0.5);
    const withChipsAlignment = await readPriceLogoThemeAlignment(page);
    expect(withChipsAlignment.logos).toHaveLength(5);
    expect(withChipsAlignment.logos.every((item) => (
        item.contract === 'global-theme-toggle-center'
        && item.clamped === '0'
        && Math.abs(item.delta) <= 0.1
    ))).toBe(true);
});

test('renders Longbridge price-level chips with price-relative colors', async ({page}) => {
    let fallbackRequests = 0;
    const categories = [
        {buy: 100, neutral: 200, sell: 300},
        {buy: 220, neutral: 140, sell: 80},
        {buy: 40, neutral: 90, sell: 170},
    ];
    await page.route('**/api/compare/chips**', async (route) => {
        fallbackRequests += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: ['AAPL', 'QQQ', 'SPY', 'DRAM'].map((ticker, tickerIndex) => ({
                    ticker,
                    source: 'longbridge-trade-stats',
                    statistics: {average_price: 100 + (tickerIndex * 100), total_volume: 2_000},
                    trades: categories.map((row, rowIndex) => ({
                        price: 100 + (tickerIndex * 100) + rowIndex,
                        ...row,
                    })),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=QQQ&ticker=SPY&ticker=DRAM&period=1y');
    await page.evaluate(() => {
        window.WORTHWARD_APP.chart.series.forEach((series) => {
            series.ohlcv = [];
        });
        const item = window.WORTHWARD_APP.chart.series[0];
        item.prices = item.prices.map((_value, index, values) => (
            index === values.length - 1 ? 100.5 : 190 + (index * 0.01)
        ));
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
    });
    await page.locator('label[for="show_chips"]').click();
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="longbridge-trade-stats"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-category-stack="none"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-color-model="price-relative"]')).toHaveCount(4);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-poc-style="price-relative-opacity"]')).toHaveCount(4);
    expect(fallbackRequests).toBe(1);

    const categoryGeometry = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const profile = window.Chart.getChart(canvas).$costDistribution;
        const bins = profile.distribution.bins.filter((bin) => bin.weight > 0);
        const poc = bins.find((bin) => bin.index === profile.distribution.pocIndex);
        return {
            categoryTotals: profile.distribution.categoryTotals,
            binCount: profile.distribution.bins.length,
            normalizedWidth: poc.normalizedWidth,
            currentPrice: profile.currentPrice,
            hasProfitBin: bins.some((bin) => bin.price < profile.currentPrice),
            hasLossBin: bins.some((bin) => bin.price >= profile.currentPrice),
        };
    });
    expect(categoryGeometry.binCount).toBe(100);
    expect(categoryGeometry.categoryTotals).toEqual({buy: 360, neutral: 430, sell: 550});
    expect(categoryGeometry.normalizedWidth).toBe(1);
    expect(categoryGeometry.hasProfitBin).toBe(true);
    expect(categoryGeometry.hasLossBin).toBe(true);

    const paintedChipColors = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const chart = window.Chart.getChart(canvas);
        const context = chart.ctx;
        const tokenContext = document.createElement('canvas').getContext('2d');
        const normalize = (value) => {
            tokenContext.fillStyle = value;
            return tokenContext.fillStyle;
        };
        const expected = {
            profit: normalize(getComputedStyle(document.body).getPropertyValue('--theme-accent-positive').trim()),
            loss: normalize(getComputedStyle(document.body).getPropertyValue('--theme-accent-secondary').trim()),
        };
        const panelLeft = chart.chartArea.right + 10;
        const calls = [];
        const originalFillRect = context.fillRect;
        context.fillRect = function fillRect(x, y, width, height) {
            if (x >= panelLeft && y >= chart.chartArea.top && y <= chart.chartArea.bottom) {
                calls.push({style: this.fillStyle, x, y, width, height});
            }
            return originalFillRect.apply(this, arguments);
        };
        try {
            chart.draw();
        } finally {
            context.fillRect = originalFillRect;
        }
        return {
            expected,
            actual: [...new Set(calls.map((call) => call.style))],
            barCount: calls.length,
        };
    });
    expect(paintedChipColors.barCount).toBeGreaterThan(0);
    expect(paintedChipColors.actual).toEqual(expect.arrayContaining([
        paintedChipColors.expected.profit,
        paintedChipColors.expected.loss,
    ]));
});

test('uses range-wide OHLCV chips when Longbridge price buckets are too narrow', async ({page}) => {
    let fallbackRequests = 0;
    await page.route('**/api/compare/chips**', async (route) => {
        fallbackRequests += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: ['AAPL', 'QQQ', 'SPY', 'DRAM'].map((ticker, tickerIndex) => ({
                    ticker,
                    source: 'longbridge-trade-stats',
                    trades: [
                        {price: 100 + (tickerIndex * 100), buy: 120, neutral: 80, sell: 40},
                        {price: 101 + (tickerIndex * 100), buy: 80, neutral: 120, sell: 60},
                    ],
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=AAPL&ticker=QQQ&ticker=SPY&ticker=DRAM&period=1y');
    await page.evaluate(() => {
        const start = Date.UTC(2026, 0, 2);
        window.WORTHWARD_APP.chart.series.forEach((item, tickerIndex) => {
            const base = 100 + (tickerIndex * 100);
            item.ohlcv = Array.from({length: 90}, (_, rowIndex) => {
                const close = base + (rowIndex * 0.9);
                const timestamp = new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10);
                return {
                    t: `${timestamp} 00:00`,
                    o: close - 1,
                    h: close + 3,
                    l: close - 3,
                    c: close,
                    v: 100_000 + ((rowIndex % 7) * 10_000),
                    synthetic: false,
                };
            });
        });
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
    });

    await page.locator('label[for="show_chips"]').click();
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(4);
    const chipShape = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => ({
            source: canvas.dataset.chipSource,
            populatedBins: Number(canvas.dataset.chipPopulatedBinCount),
        }))
    ));
    expect(chipShape.every((item) => item.source === 'ohlcv-estimate' && item.populatedBins > 10)).toBe(true);
    expect(fallbackRequests).toBe(0);
});

test('reuses the cached chip payload when removing an unchanged ticker', async ({page}) => {
    await requireChipFallback(page);
    let chipRequests = 0;
    const tickers = ['SPY', 'QQQ', 'MU', 'DRAM'];
    const start = Date.UTC(2025, 7, 25);
    const buildCachedOhlcv = (tickerIndex) => Array.from({length: 90}, (_, rowIndex) => {
        const close = 100 + (tickerIndex * 100) + (rowIndex * 0.8);
        const date = new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10);
        return {
            t: `${date} 00:00`,
            o: close - 1,
            h: close + 3,
            l: close - 3,
            c: close,
            v: 100_000 + ((rowIndex % 7) * 10_000),
            synthetic: false,
        };
    });
    await page.route('**/api/compare/chips**', async (route) => {
        chipRequests += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers.map((ticker, tickerIndex) => ({
                    ticker,
                    source: 'longbridge-daily-ohlcv',
                    ohlcv: buildCachedOhlcv(tickerIndex),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=SPY&ticker=QQQ&ticker=MU&ticker=DRAM&range=2y');
    await page.locator('label[for="show_chips"]').click();
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(4);
    expect(chipRequests).toBe(1);

    await page.locator('.ticker-field:nth-of-type(4) .ticker-remove').click();
    await expect(page).toHaveURL(/ticker=SPY.*ticker=QQQ.*ticker=MU.*range=2y.*chips=1/);
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(3);
    await expect(page.locator('[data-chip-loading-spinner]:not([hidden])')).toHaveCount(0);
    expect(chipRequests).toBe(1);
});

test('reuses unchanged chip profiles and scopes replacement loading to the new ticker', async ({page}) => {
    await requireChipFallback(page);
    const initialTickers = ['SPY', 'QQQ', 'MU'];
    const chipRequests = [];
    let releaseReplacementResponse;
    const replacementResponseGate = new Promise((resolve) => {
        releaseReplacementResponse = resolve;
    });
    const start = Date.UTC(2025, 7, 25);
    const buildCachedOhlcv = (tickerIndex) => Array.from({length: 90}, (_, rowIndex) => {
        const close = 100 + (tickerIndex * 100) + (rowIndex * 0.8);
        const date = new Date(start + (rowIndex * 86_400_000)).toISOString().slice(0, 10);
        return {
            t: `${date} 00:00`,
            o: close - 1,
            h: close + 3,
            l: close - 3,
            c: close,
            v: 100_000 + ((rowIndex % 7) * 10_000),
            synthetic: false,
        };
    });
    await page.route('**/api/compare/chips**', async (route) => {
        const tickers = new URL(route.request().url()).searchParams.getAll('ticker');
        chipRequests.push(tickers);
        if (chipRequests.length === 1) {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    series: initialTickers.map((ticker, tickerIndex) => ({
                        ticker,
                        source: 'longbridge-daily-ohlcv',
                        ohlcv: buildCachedOhlcv(tickerIndex),
                    })),
                    errors: {},
                }),
            });
            return;
        }
        await replacementResponseGate;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                series: tickers.map((ticker) => ({
                    ticker,
                    source: 'longbridge-daily-ohlcv',
                    ohlcv: buildCachedOhlcv(ticker === 'DRAM' ? 3 : 0),
                })),
                errors: {},
            }),
        });
    });

    await page.goto('/workspaces/prices?ticker=SPY&ticker=QQQ&ticker=MU&range=2y&chips=1');
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(3);
    expect(chipRequests).toEqual([initialTickers]);

    await page.locator('#ticker_2').fill('DRAM');
    await page.locator('#ticker_2').press('Enter');
    await expect(page).toHaveURL(/ticker=SPY.*ticker=DRAM.*ticker=MU.*range=2y.*chips=1/);
    await expect.poll(() => chipRequests.length).toBe(2);
    expect(chipRequests[1]).toEqual(['DRAM', 'SPY']);
    await expect(page.locator('[data-price-subplot][aria-busy="true"]')).toHaveCount(1);
    await expect(page.locator('[data-price-subplot][aria-busy="true"]')).toHaveAttribute('data-ticker', 'DRAM');
    await expect(page.locator('[data-price-subplot][data-ticker="SPY"][aria-busy="false"]')).toHaveCount(1);
    await expect(page.locator('[data-price-subplot][data-ticker="MU"][aria-busy="false"]')).toHaveCount(1);
    await expect(page.locator('[data-price-subplot][data-ticker="SPY"] [data-chip-loading-spinner][hidden]')).toHaveCount(1);
    await expect(page.locator('[data-price-subplot][data-ticker="MU"] [data-chip-loading-spinner][hidden]')).toHaveCount(1);

    releaseReplacementResponse();
    await expect(page.locator('[data-price-subplot-canvas][data-chip-source="ohlcv-estimate"]')).toHaveCount(3);
    await expect(page.locator('[data-chip-loading-spinner][hidden]')).toHaveCount(3);
});
