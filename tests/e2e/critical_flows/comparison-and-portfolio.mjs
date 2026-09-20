/* Code version: v1.4.1 */
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
test('switches between return comparison and Ticker comparison workspaces', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    const chartRuntimeSources = await page.locator('script[src]').evaluateAll((scripts) => (
        scripts.map((script) => script.src).filter((source) => source.includes('/vendor/chart/'))
    ));
    expect(chartRuntimeSources).toHaveLength(4);
    expect(chartRuntimeSources.every((source) => new URL(source).pathname.startsWith('/static/assets/js/vendor/chart/'))).toBe(true);
    await expect(page.locator('.workspace-nav-item-compare')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#app_sidebar .workspace-mode-nav > a')).toHaveCount(4);
    await expect(page.locator('#app_sidebar a[href="/workspaces/dca"]')).toHaveCount(0);

    const readWorkspaceHeadingLayout = () => page.evaluate(() => {
        const title = document.querySelector('.workspace-mode-title-card .report-heading').getBoundingClientRect();
        const result = document.querySelector('.workspace-mode-main .workspace-summary-card .report-heading').getBoundingClientRect();
        const sidebarTitle = document.querySelector('#app_sidebar .hero h1').getBoundingClientRect();
        const toggle = document.querySelector('#sidebar_toggle').getBoundingClientRect();
        const theme = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        const controls = document.querySelector('.workspace-mode-controls-surface').getBoundingClientRect();
        const main = document.querySelector('.workspace-mode-main').getBoundingClientRect();
        const centerY = (rect) => rect.top + (rect.height / 2);
        return {
            titleCenterDelta: Math.abs(centerY(title) - centerY(toggle)),
            resultCenterDelta: Math.abs(centerY(result) - centerY(theme)),
            sidebarCenterDelta: Math.abs(centerY(sidebarTitle) - centerY(toggle)),
            bottomDelta: Math.abs(controls.bottom - main.bottom),
            controlsTop: controls.top,
        };
    });
    const compareHeadingLayout = await readWorkspaceHeadingLayout();
    expect(compareHeadingLayout.titleCenterDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.resultCenterDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.sidebarCenterDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.bottomDelta).toBeLessThanOrEqual(1);
    expect(compareHeadingLayout.controlsTop).toBeLessThanOrEqual(64);

    await page.getByRole('link', {name: 'Ticker comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/prices/);
    await expect(page.locator('.workspace-nav-item-prices')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.workspace-mode-title-card')).toContainText('Price performance');
    await expect(page.getByRole('heading', {name: 'Price performance', exact: true, level: 2})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Price history', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('.price-compare-workspace')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-controls-surface')).toHaveAttribute('aria-labelledby', 'ticker_comparison_heading');
    await expect(page.locator('.workspace-mode-main')).toHaveAttribute('aria-labelledby', 'price_history_heading');
    const priceResultArticle = page.locator('xpath=/html/body/main/div/section/section/div/section/div/article');
    await expect(priceResultArticle).toHaveCount(1);
    await expect(priceResultArticle.locator('.price-compare-range')).toHaveCount(1);
    await expect(page.locator('xpath=/html/body/main/div/section/section/div/section/div/header/div/span')).toHaveCount(0);

    const aaplLogo = page.locator('.ticker-input-control:has(input[value="AAPL"]) .ticker-input-logo');
    const aaplLogoState = async () => aaplLogo.evaluate((logo) => {
        const slot = logo.closest('.ticker-leading-slot');
        return {
            imageBorderRadius: getComputedStyle(logo).borderRadius,
            imageObjectFit: getComputedStyle(logo).objectFit,
            slotOverflow: getComputedStyle(slot).overflow,
        };
    });
    const expectedAaplLogoState = {
        imageBorderRadius: '0px',
        imageObjectFit: 'contain',
        slotOverflow: 'visible',
    };
    await expect(aaplLogo).toBeVisible();
    expect(await aaplLogoState()).toEqual(expectedAaplLogoState);

    const priceHeadingLayout = await readWorkspaceHeadingLayout();
    expect(priceHeadingLayout.titleCenterDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.resultCenterDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.sidebarCenterDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.bottomDelta).toBeLessThanOrEqual(1);
    expect(priceHeadingLayout.controlsTop).toBeLessThanOrEqual(64);

    const priceRangeGeometry = await page.evaluate(() => {
        const heading = document.querySelector('.workspace-mode-main .report-heading').getBoundingClientRect();
        const range = document.querySelector('.price-compare-range').getBoundingClientRect();
        const modeCard = document.querySelector('.workspace-mode-title-card').getBoundingClientRect();
        const controls = document.querySelector('.workspace-mode-controls-surface').getBoundingClientRect();
        const resultCard = document.querySelector('.workspace-mode-main .workspace-summary-card').getBoundingClientRect();
        const main = document.querySelector('.workspace-mode-main').getBoundingClientRect();
        return {
            leftDelta: Math.abs(heading.left - range.left),
            verticalGap: range.top - heading.bottom,
            modeColumnDelta: Math.abs(modeCard.right - controls.right),
            resultColumnDelta: Math.abs(resultCard.left - main.left),
            titleColumnGap: resultCard.left - modeCard.right,
        };
    });
    expect(priceRangeGeometry.leftDelta).toBeLessThanOrEqual(1);
    expect(priceRangeGeometry.verticalGap).toBeGreaterThanOrEqual(1);
    expect(priceRangeGeometry.modeColumnDelta).toBeLessThanOrEqual(1);
    expect(priceRangeGeometry.resultColumnDelta).toBeLessThanOrEqual(1);
    expect(priceRangeGeometry.titleColumnGap).toBeGreaterThanOrEqual(11);

    await page.locator('#global_theme_toggle').click();
    expect(await aaplLogoState()).toEqual(expectedAaplLogoState);
    await page.locator('#global_theme_toggle').click();
});

test('keeps the merged DCA strategy out of the optimistic workspace sidebar', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT');

    const navigationState = await page.evaluate(() => {
        const cases = [
            {view: 'tickers', targetUrl: '/workspaces/compare', pageTitle: 'Return comparison', resultTitle: 'Performance summary', order: ['result-title', 'summary', 'chart']},
            {view: 'prices', targetUrl: '/workspaces/prices', pageTitle: 'Price performance', resultTitle: 'Price history', order: ['result-title', 'chart']},
            {view: 'prices', targetUrl: '/workspaces/prices?metric=market-cap', pageTitle: 'Market cap comparison', resultTitle: 'Market cap history', order: ['result-title', 'chart']},
            {view: 'portfolio', targetUrl: '/workspaces/portfolio', pageTitle: 'Portfolio', resultTitle: 'Portfolio summary', order: ['result-title', 'chart', 'summary']},
            {view: 'dca', targetUrl: '/workspaces/backtest?strategy=dca', pageTitle: 'Backtest', resultTitle: 'Performance', order: ['result-title', 'overview', 'resizer', 'history']},
            {view: 'backtest', targetUrl: '/workspaces/backtest?strategy=grid-trading', pageTitle: 'Backtest', resultTitle: 'Performance', order: ['result-title', 'overview', 'resizer', 'history']},
            {view: 'backtest', targetUrl: '/workspaces/backtest?strategy=lstm-price-field', pageTitle: 'Backtest', resultTitle: 'Performance', order: ['result-title', 'overview', 'resizer', 'history']},
        ];
        const skeletons = cases.map((testCase) => {
            const rendered = window.WORTHWARD_BOOTSTRAP.renderOptimisticNavigationSkeleton(testCase);
            const root = document.querySelector('[data-navigation-skeleton-view]');
            const results = root?.querySelector('.workspace-mode-results-stack');
            return {
                rendered,
                view: root?.dataset.navigationSkeletonView,
                pageTitle: root?.querySelector('[data-navigation-skeleton-region="page-title"]')?.textContent.trim(),
                resultTitle: root?.querySelector('[data-navigation-skeleton-region="result-title"]')?.textContent.trim(),
                order: Array.from(results?.children || []).map((node) => node.dataset.navigationSkeletonRegion),
                historySegmentCount: root?.querySelectorAll('.navigation-skeleton-segments .navigation-skeleton-line').length || 0,
                metricCount: root?.querySelectorAll('.navigation-skeleton-metrics-grid .navigation-skeleton-metric').length || 0,
                activeSidebarLabel: document.querySelector('.navigation-skeleton-sidebar-nav .settings-nav-item.is-active .settings-nav-label')?.textContent.trim() || '',
                hasCurrentTopology: Boolean(
                    root?.querySelector(':scope > .workspace-mode-layout > [data-navigation-skeleton-region="controls"]')
                    && root?.querySelector(':scope > .workspace-mode-layout > .workspace-mode-main > .workspace-mode-results-stack'),
                ),
            };
        });
        const sidebar = document.querySelector('#app_sidebar');
        return {
            skeletons,
            labels: [...sidebar.querySelectorAll('.navigation-skeleton-sidebar-nav .settings-nav-label')]
                .map((node) => node.textContent.trim()),
            hasDcaLabel: sidebar.textContent.includes('Dollar-cost averaging'),
        };
    });

    expect(navigationState.labels).toEqual(['Return comparison', 'Ticker comparison', 'Compute your portfolio', 'Backtest']);
    expect(navigationState.hasDcaLabel).toBe(false);
    expect(navigationState.skeletons).toEqual([
        {rendered: true, view: 'tickers', pageTitle: 'Return comparison', resultTitle: 'Performance summary', order: ['result-title', 'summary', 'chart'], historySegmentCount: 0, metricCount: 0, activeSidebarLabel: 'Return comparison', hasCurrentTopology: true},
        {rendered: true, view: 'prices', pageTitle: 'Price performance', resultTitle: 'Price history', order: ['result-title', 'chart'], historySegmentCount: 0, metricCount: 0, activeSidebarLabel: 'Ticker comparison', hasCurrentTopology: true},
        {rendered: true, view: 'prices', pageTitle: 'Market cap comparison', resultTitle: 'Market cap history', order: ['result-title', 'chart'], historySegmentCount: 0, metricCount: 0, activeSidebarLabel: 'Ticker comparison', hasCurrentTopology: true},
        {rendered: true, view: 'portfolio', pageTitle: 'Portfolio', resultTitle: 'Portfolio summary', order: ['result-title', 'chart', 'summary'], historySegmentCount: 0, metricCount: 0, activeSidebarLabel: 'Compute your portfolio', hasCurrentTopology: true},
        {rendered: true, view: 'dca', pageTitle: 'Backtest', resultTitle: 'Performance', order: ['result-title', 'overview', 'resizer', 'history'], historySegmentCount: 2, metricCount: 9, activeSidebarLabel: 'Backtest', hasCurrentTopology: true},
        {rendered: true, view: 'backtest', pageTitle: 'Backtest', resultTitle: 'Performance', order: ['result-title', 'overview', 'resizer', 'history'], historySegmentCount: 2, metricCount: 10, activeSidebarLabel: 'Backtest', hasCurrentTopology: true},
        {rendered: true, view: 'backtest', pageTitle: 'Backtest', resultTitle: 'Performance', order: ['result-title', 'overview', 'resizer', 'history'], historySegmentCount: 3, metricCount: 10, activeSidebarLabel: 'Backtest', hasCurrentTopology: true},
    ]);
});

test('replaces stale Price content with a target-aligned Portfolio skeleton during real navigation', async ({page}) => {
    await page.addInitScript(() => {
        window.sessionStorage.setItem('worthward:sidebar-open', 'false');
    });
    await page.setViewportSize({width: 1_058, height: 900});
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&period=1y');

    let releaseNavigation;
    const navigationGate = new Promise((resolve) => {
        releaseNavigation = resolve;
    });
    let markNavigationRequested;
    const navigationRequested = new Promise((resolve) => {
        markNavigationRequested = resolve;
    });
    await page.route('**/workspaces/portfolio*', async (route) => {
        if (!route.request().isNavigationRequest()) {
            await route.continue();
            return;
        }
        markNavigationRequested();
        await navigationGate;
        await route.continue();
    });

    const wideState = await page.locator('.workspace-nav-item-portfolio').evaluate((link) => {
        link.click();
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const layout = rect('.navigation-skeleton-page > .workspace-mode-layout');
        const controls = rect('[data-navigation-skeleton-region="controls"]');
        const main = rect('.navigation-skeleton-page .workspace-mode-main');
        const resultTitle = rect('[data-navigation-skeleton-region="result-title"]');
        const chart = rect('[data-navigation-skeleton-region="chart"]');
        const summary = rect('[data-navigation-skeleton-region="summary"]');
        const workspacePanel = document.querySelector('#workspace_panel');
        const text = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
        if (!layout || !controls || !main || !resultTitle || !chart || !summary || !workspacePanel) return null;
        return {
            ariaBusy: workspacePanel.getAttribute('aria-busy'),
            navigationSkeleton: workspacePanel.dataset.navigationSkeleton,
            pageNavigating: document.body.classList.contains('is-page-navigating'),
            navigationTarget: document.documentElement.dataset.navigationTarget,
            documentAriaBusy: document.documentElement.getAttribute('aria-busy'),
            oldPriceShellCount: document.querySelectorAll('.price-compare-workspace').length,
            oldPriceChartCount: document.querySelectorAll('#price_subplot_region').length,
            pageTitle: text('[data-navigation-skeleton-region="page-title"]'),
            resultTitle: text('[data-navigation-skeleton-region="result-title"]'),
            chartTitle: text('[data-navigation-skeleton-region="chart"]'),
            resultOrder: Array.from(document.querySelector('.workspace-mode-results-stack').children)
                .map((node) => node.dataset.navigationSkeletonRegion),
            columnGap: main.left - controls.right,
            layoutLeftDelta: Math.abs(layout.left - controls.left),
            resultLeftDelta: Math.abs(main.left - resultTitle.left),
            resultWidthDelta: Math.abs(main.width - resultTitle.width),
            chartWidthDelta: Math.abs(main.width - chart.width),
            summaryWidthDelta: Math.abs(main.width - summary.width),
            chartBeforeSummary: chart.top < summary.top,
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
    });
    expect(wideState).not.toBeNull();
    expect(wideState.ariaBusy).toBe('true');
    expect(wideState.navigationSkeleton).toBe('1');
    expect(wideState.pageNavigating).toBe(true);
    expect(wideState.navigationTarget).toBe('portfolio');
    expect(wideState.documentAriaBusy).toBe('true');
    expect(wideState.oldPriceShellCount).toBe(0);
    expect(wideState.oldPriceChartCount).toBe(0);
    expect(wideState.pageTitle).toBe('Portfolio');
    expect(wideState.resultTitle).toBe('Portfolio summary');
    expect(wideState.chartTitle).toContain('Portfolio return chart');
    expect(wideState.resultOrder).toEqual(['result-title', 'chart', 'summary']);
    expect(wideState.columnGap).toBeGreaterThanOrEqual(11);
    expect(wideState.columnGap).toBeLessThanOrEqual(13);
    expect(wideState.layoutLeftDelta).toBeLessThanOrEqual(1);
    expect(wideState.resultLeftDelta).toBeLessThanOrEqual(1);
    expect(wideState.resultWidthDelta).toBeLessThanOrEqual(1);
    expect(wideState.chartWidthDelta).toBeLessThanOrEqual(1);
    expect(wideState.summaryWidthDelta).toBeLessThanOrEqual(1);
    expect(wideState.chartBeforeSummary).toBe(true);
    expect(wideState.noHorizontalOverflow).toBe(true);

    await navigationRequested;
    releaseNavigation();
    await expect(page).toHaveURL(/\/workspaces\/portfolio/);
    await expect(page.locator('[data-navigation-skeleton]')).toHaveCount(0);
    await expect(page.locator('#workspace_panel')).not.toHaveAttribute('aria-busy', 'true');

    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&period=1y');
    const narrowGeometry = await page.evaluate(() => {
        window.WORTHWARD_BOOTSTRAP.renderOptimisticNavigationSkeleton({
            view: 'portfolio',
            targetUrl: '/workspaces/portfolio',
        });
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const title = rect('[data-navigation-skeleton-region="page-title"]');
        const layout = rect('.navigation-skeleton-page > .workspace-mode-layout');
        const controls = rect('[data-navigation-skeleton-region="controls"]');
        const main = rect('.navigation-skeleton-page .workspace-mode-main');
        const chart = rect('[data-navigation-skeleton-region="chart"]');
        const summary = rect('[data-navigation-skeleton-region="summary"]');
        if (!title || !layout || !controls || !main || !chart || !summary) return null;
        return {
            titleLeftDelta: Math.abs(title.left - layout.left),
            controlsLeftDelta: Math.abs(controls.left - layout.left),
            mainLeftDelta: Math.abs(main.left - layout.left),
            controlsWidthDelta: Math.abs(controls.width - layout.width),
            mainWidthDelta: Math.abs(main.width - layout.width),
            stackGap: main.top - controls.bottom,
            chartBeforeSummary: chart.top < summary.top,
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
    });
    expect(narrowGeometry).not.toBeNull();
    expect(narrowGeometry.titleLeftDelta).toBeLessThanOrEqual(1);
    expect(narrowGeometry.controlsLeftDelta).toBeLessThanOrEqual(1);
    expect(narrowGeometry.mainLeftDelta).toBeLessThanOrEqual(1);
    expect(narrowGeometry.controlsWidthDelta).toBeLessThanOrEqual(1);
    expect(narrowGeometry.mainWidthDelta).toBeLessThanOrEqual(1);
    expect(narrowGeometry.stackGap).toBeGreaterThanOrEqual(11);
    expect(narrowGeometry.stackGap).toBeLessThanOrEqual(13);
    expect(narrowGeometry.chartBeforeSummary).toBe(true);
    expect(narrowGeometry.noHorizontalOverflow).toBe(true);
});

test('masks stale Price results throughout same-page optimistic hydration', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&period=1y');

    let releaseHydration;
    const hydrationGate = new Promise((resolve) => {
        releaseHydration = resolve;
    });
    let markHydrationRequested;
    const hydrationRequested = new Promise((resolve) => {
        markHydrationRequested = resolve;
    });
    await page.route('**/workspaces/prices*', async (route) => {
        if (route.request().headers()['x-requested-with'] !== 'workspace-hydrate') {
            await route.continue();
            return;
        }
        markHydrationRequested();
        await hydrationGate;
        await route.continue();
    });

    await page.getByRole('button', {name: /^Period:/}).click();
    await page.getByRole('listbox', {name: 'Period', exact: true})
        .getByRole('option', {name: '2 years', exact: true})
        .click();
    await hydrationRequested;

    const workspacePanel = page.locator('#workspace_panel');
    await expect(workspacePanel).toHaveAttribute('data-workspace-pending', '1');
    await expect(workspacePanel).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('body')).toHaveClass(/is-workspace-switching/);
    const pendingMasks = page.locator('#workspace_panel [data-workspace-mask].is-masked-during-switch');
    expect(await pendingMasks.count()).toBeGreaterThan(0);
    await expect(page.locator('#price_subplot_region')).toHaveClass(/is-masked-during-switch/);
    await expect(page.locator('[data-workspace-mask="page-heading"]')).toHaveClass(/is-masked-during-switch/);
    await expect(page.locator('[data-workspace-mask="result-heading"]')).toHaveClass(/is-masked-during-switch/);
    await expect(page.locator('[data-workspace-mask="result-date-range"]')).toHaveClass(/is-masked-during-switch/);

    releaseHydration();
    await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('2y');
    await expect(workspacePanel).not.toHaveAttribute('data-workspace-pending', '1');
    await expect(workspacePanel).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('body')).not.toHaveClass(/is-workspace-switching/);
    await expect(page.locator('.is-masked-during-switch')).toHaveCount(0);
});

test('keeps Backtest pending glass fixed over exact graphics and values', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 1007, height: 1_355});
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    await page.evaluate(() => window.WORTHWARD_BOOTSTRAP.applyWorkspacePendingState());
    const compareSummary = page.locator('#compare_summary_panel');
    await expect(compareSummary).toHaveClass(/is-masked-during-switch/);
    await expect(compareSummary).toHaveCSS('pointer-events', 'none');
    await expect(compareSummary.locator(':scope > *').first()).toHaveCSS('opacity', '0');
    await expect(compareSummary.locator(':scope > *').first()).toHaveCSS('visibility', 'hidden');
    await expect(compareSummary).toContainText('AAPL');

    await page.goto('/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=1y');
    await page.evaluate(() => window.WORTHWARD_BOOTSTRAP.applyWorkspacePendingState());
    await expect(page.locator('.portfolio-summary-range')).toHaveClass(/is-masked-during-switch/);

    await page.emulateMedia({colorScheme: 'dark'});
    await page.goto(
        '/workspaces/backtest?ticker=QQQ&range=6mo&strategy=bayesian-price-field'
        + '&cell_display_threshold=2.50',
    );
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(page.locator('#backtest_probability_detail_panel')).toBeVisible();
    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    const tuneColors = await tuneButton.evaluate((button) => {
        const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = (value) => {
            const channels = parse(value).map((channel) => {
                const normalized = channel / 255;
                return normalized <= 0.04045
                    ? normalized / 12.92
                    : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
        };
        const style = getComputedStyle(button);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return {
            backgroundColor: style.backgroundColor,
            contrast: (Math.max(foreground, background) + 0.05)
                / (Math.min(foreground, background) + 0.05),
        };
    });
    expect(tuneColors.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(tuneColors.contrast).toBeGreaterThanOrEqual(4.5);

    await page.evaluate(() => window.WORTHWARD_BOOTSTRAP.applyWorkspacePendingState());
    const backtestHistory = page.locator('#backtest_history_surface');
    await expect(backtestHistory).not.toHaveClass(/is-masked-during-switch/);
    await expect(page.locator('[data-workspace-mask="backtest-history"]')).toHaveCount(0);
    await expect(page.locator('[data-workspace-mask="backtest-chart-stage"]')).toHaveCount(0);
    const priceMask = page.locator('[data-workspace-mask="trade-price-chart"]');
    await expect(priceMask).toHaveClass(/is-masked-during-switch/);
    await expect(page.locator('[data-workspace-mask="trade-equity-chart"]')).toHaveClass(/is-masked-during-switch/);
    const metricMasks = page.locator('[data-workspace-mask="trade-metric"]');
    expect(await metricMasks.count()).toBeGreaterThan(0);
    await expect(metricMasks.first()).toHaveClass(/is-masked-during-switch/);
    const probabilityMask = page.locator('[data-workspace-mask="backtest-probability-detail-plot"]');
    await expect(probabilityMask).toHaveClass(/is-masked-during-switch/);
    await expect(probabilityMask.locator(':scope > .backtest-probability-detail-main'))
        .toHaveCSS('opacity', '0.18');

    const initialMaskState = await priceMask.evaluate((mask) => {
        const rect = mask.getBoundingClientRect();
        const overlay = getComputedStyle(mask, '::after');
        return {
            backgroundPosition: overlay.backgroundPosition,
            height: rect.height,
            left: rect.left,
            maskTransform: getComputedStyle(mask).transform,
            overlayAnimationName: overlay.animationName,
            overlayTransform: overlay.transform,
            top: rect.top,
            width: rect.width,
        };
    });
    await page.waitForTimeout(120);
    const settledMaskState = await priceMask.evaluate((mask) => {
        const rect = mask.getBoundingClientRect();
        return {
            backgroundPosition: getComputedStyle(mask, '::after').backgroundPosition,
            height: rect.height,
            left: rect.left,
            top: rect.top,
            width: rect.width,
        };
    });
    expect(initialMaskState.maskTransform).toBe('none');
    expect(initialMaskState.overlayTransform).toBe('none');
    expect(initialMaskState.overlayAnimationName).toBe('workspace-pending-highlight');
    expect(settledMaskState.backgroundPosition).not.toBe(initialMaskState.backgroundPosition);
    for (const key of ['height', 'left', 'top', 'width']) {
        expect(Math.abs(settledMaskState[key] - initialMaskState[key])).toBeLessThanOrEqual(0.01);
    }
});

test('rejects a delayed Price hydration after a Portfolio navigation skeleton takes ownership', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&period=1y');
    const initialUrl = page.url();

    let releaseHydration;
    const hydrationGate = new Promise((resolve) => {
        releaseHydration = resolve;
    });
    let markHydrationRequested;
    const hydrationRequested = new Promise((resolve) => {
        markHydrationRequested = resolve;
    });
    let markHydrationDelivered;
    const hydrationDelivered = new Promise((resolve) => {
        markHydrationDelivered = resolve;
    });
    await page.route('**/workspaces/prices*', async (route) => {
        if (route.request().headers()['x-requested-with'] !== 'workspace-hydrate') {
            await route.continue();
            return;
        }
        const response = await route.fetch();
        markHydrationRequested();
        await hydrationGate;
        await route.fulfill({response});
        markHydrationDelivered();
    });

    await page.getByRole('button', {name: /^Period:/}).click();
    await page.getByRole('listbox', {name: 'Period', exact: true})
        .getByRole('option', {name: '2 years', exact: true})
        .click();
    await hydrationRequested;
    await page.evaluate(() => {
        document.body.classList.add('is-workspace-switching', 'is-page-navigating');
        document.documentElement.dataset.navigationTarget = 'portfolio';
        document.documentElement.setAttribute('aria-busy', 'true');
        window.WORTHWARD_BOOTSTRAP.renderOptimisticNavigationSkeleton({
            view: 'portfolio',
            targetUrl: '/workspaces/portfolio',
        });
    });

    releaseHydration();
    await hydrationDelivered;
    await page.waitForTimeout(100);
    await expect(page.locator('[data-navigation-skeleton-view="portfolio"]')).toHaveCount(1);
    await expect(page.locator('#workspace_panel')).toHaveAttribute('data-navigation-skeleton', '1');
    await expect(page.locator('#workspace_panel')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#price_subplot_region')).toHaveCount(0);
    expect(page.url()).toBe(initialUrl);
});

for (const width of [810, 390]) {
test(`aligns the responsive Backtest parameter control with its navigation skeleton at ${width}px`, async ({page}) => {
    await page.addInitScript(() => {
        window.sessionStorage.setItem('worthward:sidebar-open', 'false');
        window.sessionStorage.removeItem('worthward:view-memory');
    });
    await page.setViewportSize({width, height: 900});
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&period=1y');

    let releaseNavigation;
    const navigationGate = new Promise((resolve) => {
        releaseNavigation = resolve;
    });
    let markNavigationRequested;
    const navigationRequested = new Promise((resolve) => {
        markNavigationRequested = resolve;
    });
    await page.route('**/workspaces/backtest*', async (route) => {
        if (!route.request().isNavigationRequest()) {
            await route.continue();
            return;
        }
        markNavigationRequested();
        await navigationGate;
        await route.continue();
    });

    const overlayGeometry = await page.locator('.workspace-nav-item-backtest').evaluate((link) => {
        link.click();
        const toggleElement = document.querySelector('[data-navigation-skeleton-backtest-toggle]');
        const titleElement = document.querySelector('[data-navigation-skeleton-region="page-title"] .report-heading');
        if (!(toggleElement instanceof HTMLElement) || !(titleElement instanceof HTMLElement)) return null;
        const toggle = toggleElement.getBoundingClientRect();
        const title = document.querySelector('[data-navigation-skeleton-region="page-title"] .report-heading').getBoundingClientRect();
        return {
            display: getComputedStyle(toggleElement).display,
            skeletonView: document.querySelector('[data-navigation-skeleton-view]')?.dataset.navigationSkeletonView,
            titleClearsToggle: title.left >= toggle.right + 8,
            toggleInsideViewport: toggle.left >= 0 && toggle.right <= window.innerWidth,
        };
    });
    expect(overlayGeometry).not.toBeNull();
    expect(overlayGeometry.display).not.toBe('none');
    expect(overlayGeometry.skeletonView).toBe('backtest');
    expect(overlayGeometry.titleClearsToggle).toBe(true);
    expect(overlayGeometry.toggleInsideViewport).toBe(true);

    await navigationRequested;
    releaseNavigation();
    await expect(page).toHaveURL(/\/workspaces\/backtest/);
    await expect(page.locator('[data-navigation-skeleton-backtest-toggle]')).toHaveCount(0);
    await expect(page.locator('[data-backtest-parameter-toggle]')).toBeVisible();

    let releaseDeparture;
    const departureGate = new Promise((resolve) => {
        releaseDeparture = resolve;
    });
    let markDepartureRequested;
    const departureRequested = new Promise((resolve) => {
        markDepartureRequested = resolve;
    });
    await page.route('**/workspaces/portfolio*', async (route) => {
        if (!route.request().isNavigationRequest()) {
            await route.continue();
            return;
        }
        markDepartureRequested();
        await departureGate;
        await route.continue();
    });
    const departureState = await page.locator('.workspace-nav-item-portfolio').evaluate((link) => {
        link.click();
        const backtestToggle = document.querySelector('[data-backtest-parameter-toggle]');
        return {
            oldToggleHidden: backtestToggle instanceof HTMLButtonElement && backtestToggle.hidden,
            placeholderCount: document.querySelectorAll('[data-navigation-skeleton-backtest-toggle]').length,
            skeletonView: document.querySelector('[data-navigation-skeleton-view]')?.dataset.navigationSkeletonView,
        };
    });
    expect(departureState).toEqual({
        oldToggleHidden: true,
        placeholderCount: 0,
        skeletonView: 'portfolio',
    });
    await departureRequested;
    releaseDeparture();
    await expect(page).toHaveURL(/\/workspaces\/portfolio/);
    await expect(page.locator('[data-backtest-parameter-toggle]')).toHaveCount(0);
});
}

test('anchors the comparison share control to the summary panel without overlapping the theme control', async ({page}) => {
    await page.addInitScript(() => {
        window.sessionStorage.setItem('worthward:sidebar-open', 'false');
    });
    await page.setViewportSize({width: 810, height: 834});
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&ticker=MU&period=1y');

    const shareButton = page.locator('#export_transactions_button');
    await expect(shareButton).toBeVisible();

    const geometry = await page.evaluate(() => {
        const button = document.querySelector('#export_transactions_button');
        const drawer = button?.closest('[data-share-drawer="tickers"]');
        const panel = document.querySelector('#compare_summary_panel');
        const chartSurface = document.querySelector('.workspace-mode-main > .workspace-header > .chart-surface');
        const dateRange = document.querySelector('#compare_summary_date_range');
        const theme = document.querySelector('#global_theme_toggle');
        const rect = (element) => element?.getBoundingClientRect();
        const share = rect(button);
        const panelRect = rect(panel);
        const chartSurfaceRect = rect(chartSurface);
        const dateRangeRect = rect(dateRange);
        const themeRect = rect(theme);
        const overlaps = share && themeRect
            ? share.left < themeRect.right
                && share.right > themeRect.left
                && share.top < themeRect.bottom
                && share.bottom > themeRect.top
            : null;
        return {
            drawerIsDirectPanelChild: drawer?.parentElement === panel,
            overlapsTheme: overlaps,
            shareCenterXDelta: share && themeRect
                ? Math.abs((share.left + (share.width / 2)) - (themeRect.left + (themeRect.width / 2)))
                : null,
            shareTop: share?.top,
            themeBottom: themeRect?.bottom,
            dateInlineStart: dateRangeRect && panelRect
                ? dateRangeRect.left - panelRect.left
                : null,
            summaryWidthDelta: panelRect && chartSurfaceRect
                ? Math.abs(panelRect.width - chartSurfaceRect.width)
                : null,
        };
    });

    expect(geometry.drawerIsDirectPanelChild).toBe(true);
    expect(geometry.overlapsTheme).toBe(false);
    expect(geometry.shareCenterXDelta).toBeLessThanOrEqual(1);
    expect(geometry.shareTop).toBeGreaterThanOrEqual(geometry.themeBottom);
    if (geometry.dateInlineStart !== null) {
        expect(geometry.dateInlineStart).toBeCloseTo(12, 1);
    }
    expect(geometry.summaryWidthDelta).toBeLessThanOrEqual(0.01);
});

test('keeps shared shell anchors on the ten-pixel spatial grid across desktop and iPad', async ({page}) => {
    for (const viewport of [
        {width: 1280, height: 720},
        {width: 768, height: 1024},
    ]) {
        await page.setViewportSize(viewport);
        await page.goto('/workspaces/compare?ticker=SGOV&ticker=BOXX');
        await page.evaluate(() => window.sessionStorage.setItem('worthward:sidebar-open', 'true'));
        await page.reload();
        const visibleNoticeClose = page.locator('[data-dismissible-notice]:not([hidden]) .notice-close').first();
        if (await visibleNoticeClose.isVisible()) {
            await visibleNoticeClose.locator('..').hover();
            await expect(visibleNoticeClose).toHaveCSS('pointer-events', 'auto');
            await visibleNoticeClose.click();
        }
        await setSidebarExpanded(page, true);
        await page.waitForFunction(() => {
            const sidebar = document.querySelector('#app_sidebar');
            const dock = document.querySelector('.sidebar-dock');
            if (!(sidebar instanceof HTMLElement) || !(dock instanceof HTMLElement)) return false;
            const sidebarRect = sidebar.getBoundingClientRect();
            const dockMatrix = new DOMMatrix(getComputedStyle(dock).transform);
            return Math.abs(sidebarRect.left - 10) <= 1
                && Number.parseFloat(getComputedStyle(sidebar).opacity) > 0.99
                && dockMatrix.a > 0.99
                && dockMatrix.d > 0.99;
        });

        const geometry = await page.evaluate(() => {
            const sidebar = document.querySelector('#app_sidebar')?.getBoundingClientRect();
            const sidebarTitle = document.querySelector('#app_sidebar .hero h1')?.getBoundingClientRect();
            const modeTitle = document.querySelector('.workspace-mode-title-card .report-heading')?.getBoundingClientRect();
            const summaryTitle = document.querySelector('.workspace-mode-main .workspace-summary-card .report-heading')?.getBoundingClientRect();
            const toggle = document.querySelector('#sidebar_toggle')?.getBoundingClientRect();
            const dock = document.querySelector('.sidebar-dock')?.getBoundingClientRect();
            const theme = document.querySelector('#global_theme_toggle')?.getBoundingClientRect();
            const centerX = (rect) => rect.left + (rect.width / 2);
            const centerY = (rect) => rect.top + (rect.height / 2);
            const styles = document.querySelector('#app_sidebar')
                ? getComputedStyle(document.querySelector('#app_sidebar'))
                : null;
            if (!sidebar || !sidebarTitle || !modeTitle || !summaryTitle || !toggle || !dock || !theme || !styles) {
                return null;
            }
            return {
                sidebarTopGap: sidebar.top,
                sidebarLeftGap: sidebar.left,
                sidebarBottomGap: window.innerHeight - sidebar.bottom,
                sidebarRight: sidebar.right,
                sidebarRadius: Number.parseFloat(styles.borderTopLeftRadius),
                dockCenterDelta: Math.abs(centerX(dock) - centerX(sidebar)),
                dockBottomGap: sidebar.bottom - dock.bottom,
                toggleTop: toggle.top,
                toggleLeft: toggle.left,
                toggleRight: toggle.right,
                toggleRightGap: sidebar.right - toggle.right,
                themeTop: theme.top,
                themeRightGap: window.innerWidth - theme.right,
                toggleCenterY: centerY(toggle),
                sidebarTitleCenterY: centerY(sidebarTitle),
                modeTitleCenterY: centerY(modeTitle),
                summaryTitleCenterY: centerY(summaryTitle),
                themeCenterY: centerY(theme),
                sidebarTitleCenterDelta: Math.abs(centerY(sidebarTitle) - centerY(toggle)),
                modeTitleCenterDelta: Math.abs(centerY(modeTitle) - centerY(toggle)),
                summaryTitleCenterDelta: Math.abs(centerY(summaryTitle) - centerY(toggle)),
            };
        });

        expect(geometry).not.toBeNull();
        for (const key of ['sidebarTopGap', 'sidebarLeftGap', 'sidebarBottomGap', 'sidebarRadius', 'dockBottomGap', 'toggleRightGap']) {
            expect(Math.abs(geometry[key] - 10), `${key} at ${viewport.width}px: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1);
        }
        expect(geometry.dockCenterDelta, `dock center at ${viewport.width}px: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.toggleTop - 20)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.themeTop - 20)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.themeRightGap - 20)).toBeLessThanOrEqual(1);
        expect(geometry.sidebarTitleCenterDelta).toBeLessThanOrEqual(1);
        expect(geometry.modeTitleCenterDelta).toBeLessThanOrEqual(1);
        expect(geometry.summaryTitleCenterDelta).toBeLessThanOrEqual(1);

        await setSidebarExpanded(page, false);
        await page.waitForFunction(() => {
            const sidebar = document.querySelector('#app_sidebar');
            const toggle = document.querySelector('#sidebar_toggle');
            const shell = document.querySelector('.app-shell');
            if (!(sidebar instanceof HTMLElement) || !(toggle instanceof HTMLElement) || !(shell instanceof HTMLElement)) {
                return false;
            }
            return shell.classList.contains('is-sidebar-collapsed')
                && Number.parseFloat(getComputedStyle(sidebar).opacity) < 0.01
                && Math.abs(toggle.getBoundingClientRect().left - (window.innerWidth <= 600 ? 10 : 20)) <= 1;
        });
        const collapsedGeometry = await page.evaluate(() => {
            const toggle = document.querySelector('#sidebar_toggle')?.getBoundingClientRect();
            const modeTitle = document.querySelector('.workspace-mode-title-card .report-heading')?.getBoundingClientRect();
            const summaryTitle = document.querySelector('.workspace-mode-main .workspace-summary-card .report-heading')?.getBoundingClientRect();
            const theme = document.querySelector('#global_theme_toggle')?.getBoundingClientRect();
            const centerY = (rect) => rect.top + (rect.height / 2);
            const overlaps = (left, right) => left.left < right.right
                && left.right > right.left
                && left.top < right.bottom
                && left.bottom > right.top;
            if (!toggle || !modeTitle || !summaryTitle || !theme) return null;
            return {
                toggleTop: toggle.top,
                themeTop: theme.top,
                toggleCenterY: centerY(toggle),
                modeTitleCenterY: centerY(modeTitle),
                summaryTitleCenterY: centerY(summaryTitle),
                themeCenterY: centerY(theme),
                modeTitleCenterDelta: Math.abs(centerY(modeTitle) - centerY(toggle)),
                summaryTitleCenterDelta: Math.abs(centerY(summaryTitle) - centerY(toggle)),
                themeCenterDelta: Math.abs(centerY(theme) - centerY(toggle)),
                modeTitleOverlapsToggle: overlaps(modeTitle, toggle),
                summaryTitleOverlapsTheme: overlaps(summaryTitle, theme),
                toggleOverlapsTheme: overlaps(toggle, theme),
            };
        });
        expect(collapsedGeometry).not.toBeNull();
        expect(Math.abs(collapsedGeometry.toggleTop - geometry.toggleTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(collapsedGeometry.themeTop - geometry.themeTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(collapsedGeometry.toggleCenterY - geometry.toggleCenterY)).toBeLessThanOrEqual(1);
        expect(Math.abs(collapsedGeometry.modeTitleCenterY - geometry.modeTitleCenterY)).toBeLessThanOrEqual(1);
        expect(Math.abs(collapsedGeometry.summaryTitleCenterY - geometry.summaryTitleCenterY)).toBeLessThanOrEqual(1);
        expect(Math.abs(collapsedGeometry.themeCenterY - geometry.themeCenterY)).toBeLessThanOrEqual(1);
        expect(collapsedGeometry.modeTitleCenterDelta).toBeLessThanOrEqual(1);
        expect(collapsedGeometry.summaryTitleCenterDelta).toBeLessThanOrEqual(1);
        expect(collapsedGeometry.themeCenterDelta).toBeLessThanOrEqual(1);
        expect(collapsedGeometry.modeTitleOverlapsToggle).toBe(false);
        expect(collapsedGeometry.summaryTitleOverlapsTheme).toBe(false);
        expect(collapsedGeometry.toggleOverlapsTheme).toBe(false);
    }
});

test('keeps Portfolio metadata inside a full-width responsive result stack', async ({page}) => {
    await page.addInitScript(() => {
        window.sessionStorage.setItem('worthward:sidebar-open', 'false');
    });
    const url = '/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=1y';
    const readWideGeometry = () => page.evaluate(() => {
        const modeTitle = document.querySelector('.workspace-mode-title-card .report-heading').getBoundingClientRect();
        const main = document.querySelector('.workspace-mode-main').getBoundingClientRect();
        const resultStackElement = document.querySelector('.workspace-mode-main > .workspace-header');
        const resultStack = resultStackElement.getBoundingClientRect();
        const summaryTitle = document.querySelector('.workspace-mode-main > .workspace-header > .workspace-summary-card').getBoundingClientRect();
        const resultCard = document.querySelector('.workspace-mode-main > .workspace-header > .portfolio-summary-content-card').getBoundingClientRect();
        const chartSurface = document.querySelector('.workspace-mode-main > .workspace-header > .chart-surface').getBoundingClientRect();
        const resultChildren = Array.from(resultStackElement.children);
        const summaryMain = document.querySelector('.portfolio-summary-main');
        const shareButton = document.querySelector('#export_transactions_button').getBoundingClientRect();
        const shareResultCard = document.querySelector('#export_transactions_button').closest('.portfolio-summary-content-card');
        const theme = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        const toggle = document.querySelector('#sidebar_toggle').getBoundingClientRect();
        const center = (rect, axis) => rect[axis] + (rect[axis === 'left' ? 'width' : 'height'] / 2);
        return {
            modeCenterDelta: Math.abs(center(modeTitle, 'top') - center(toggle, 'top')),
            mainWidth: main.width,
            resultStackWidth: resultStack.width,
            summaryWidth: summaryTitle.width,
            resultWidth: resultCard.width,
            chartWidth: chartSurface.width,
            chartBeforeResult: resultChildren.indexOf(resultStackElement.querySelector(':scope > .chart-surface'))
                < resultChildren.indexOf(resultStackElement.querySelector(':scope > .portfolio-summary-content-card')),
            resultRightDelta: Math.abs(main.right - resultStack.right),
            chartRightDelta: Math.abs(main.right - chartSurface.right),
            shareCenterDelta: Math.abs(center(shareButton, 'left') - center(theme, 'left')),
            rangeInsideResult: Boolean(summaryMain && summaryMain.contains(document.querySelector('.portfolio-summary-range'))),
            shareInsideResult: shareResultCard === document.querySelector('.portfolio-summary-content-card'),
            shareTopInset: shareButton.top - resultCard.top,
            shareRightInset: resultCard.right - shareButton.right,
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
    });

    for (const width of [1_058, 1_352]) {
        await page.setViewportSize({width, height: 1_050});
        if (page.url() === 'about:blank') await page.goto(url);
        else await page.reload();
        await expect(page.locator('.portfolio-summary-range')).toBeVisible();
        const geometry = await readWideGeometry();

        expect(geometry.modeCenterDelta).toBeLessThanOrEqual(1);
        expect(geometry.mainWidth).toBeGreaterThan(640);
        expect(geometry.resultStackWidth).toBeCloseTo(geometry.mainWidth, 0);
        expect(geometry.summaryWidth).toBeCloseTo(geometry.mainWidth, 0);
        expect(geometry.resultWidth).toBeCloseTo(geometry.mainWidth, 0);
        expect(geometry.chartWidth).toBeCloseTo(geometry.mainWidth, 0);
        expect(geometry.chartBeforeResult).toBe(true);
        expect(geometry.resultRightDelta).toBeLessThanOrEqual(1);
        expect(geometry.chartRightDelta).toBeLessThanOrEqual(1);
        expect(geometry.shareCenterDelta).toBeLessThanOrEqual(1);
        expect(geometry.rangeInsideResult).toBe(true);
        expect(geometry.shareInsideResult).toBe(true);
        expect(geometry.shareTopInset).toBeGreaterThanOrEqual(-1);
        expect(geometry.shareRightInset).toBeGreaterThanOrEqual(8);
        expect(geometry.noHorizontalOverflow).toBe(true);
    }

    const summaryTitle = page.locator('.workspace-mode-main > .workspace-header > .workspace-summary-card .report-heading');
    const resultCard = page.locator('.workspace-mode-main > .workspace-header > .portfolio-summary-content-card');
    const range = page.locator('.portfolio-summary-range');
    const shareButton = page.locator('#export_transactions_button');
    await expect(summaryTitle).toHaveText('Portfolio summary');
    await expect(range).toBeVisible();
    await expect(range).not.toHaveText('');
    await expect(resultCard).toContainText('Portfolio ending return');
    await expect(shareButton).toBeVisible();

    await page.setViewportSize({width: 727, height: 1_178});
    await page.reload();
    await expect(page.locator('.portfolio-summary-range')).toBeVisible();
    const mediumNarrowGeometry = await page.evaluate(() => {
        const layout = document.querySelector('.workspace-mode-layout')?.getBoundingClientRect();
        const summary = document.querySelector('.workspace-mode-main > .workspace-header')?.getBoundingClientRect();
        const resultCard = document.querySelector('.portfolio-summary-content-card')?.getBoundingClientRect();
        if (!layout || !summary || !resultCard) return null;
        return {
            layoutWidth: layout.width,
            summaryWidth: summary.width,
            resultWidth: resultCard.width,
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        };
    });
    expect(mediumNarrowGeometry).not.toBeNull();
    expect(mediumNarrowGeometry.summaryWidth).toBeCloseTo(mediumNarrowGeometry.layoutWidth, 0);
    expect(mediumNarrowGeometry.resultWidth).toBeCloseTo(mediumNarrowGeometry.layoutWidth, 0);
    expect(mediumNarrowGeometry.noHorizontalOverflow).toBe(true);

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    await expect(page.locator('.portfolio-summary-range')).toBeVisible();
    const narrowGeometry = await page.evaluate(() => {
        const button = document.querySelector('#export_transactions_button')?.getBoundingClientRect();
        const card = document.querySelector('.portfolio-summary-content-card')?.getBoundingClientRect();
        return {
            noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
            shareInsideCard: Boolean(button && card && button.left >= card.left - 1 && button.right <= card.right + 1),
        };
    });
    expect(narrowGeometry.noHorizontalOverflow).toBe(true);
    expect(narrowGeometry.shareInsideCard).toBe(true);
});

test('matches the shared Compare Period dropdown width to its trigger', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    const periodDropdown = page.locator('#period_dropdown');

    await periodTrigger.click();
    await expect(periodDropdown).toBeVisible();

    const readWidthDelta = () => page.evaluate(() => {
        const trigger = document.querySelector('#period_panel [data-shared-select-trigger]');
        const dropdown = document.querySelector('#period_dropdown');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return Number.POSITIVE_INFINITY;
        return Math.abs(trigger.getBoundingClientRect().width - dropdown.getBoundingClientRect().width);
    });
    await expect.poll(readWidthDelta).toBeLessThan(0.01);

    const widths = await page.evaluate(() => ({
        trigger: document.querySelector('#period_panel [data-shared-select-trigger]')?.getBoundingClientRect().width,
        dropdown: document.querySelector('#period_dropdown')?.getBoundingClientRect().width,
    }));
    expect(widths.dropdown).toBeCloseTo(widths.trigger, 5);
});

test('constrains the Portfolio Period dropdown to the shared 384px control token', async ({page}) => {
    await page.goto('/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=1y');

    const periodField = page.locator('#period_panel [data-shared-select-field]');
    const periodTrigger = periodField.locator('[data-shared-select-trigger]');
    const periodDropdown = page.locator('#period_dropdown');
    await expect(periodField).toHaveCount(1);
    await expect(periodTrigger).toHaveClass(/backtest-shared-select-trigger/);
    await expect(periodDropdown).toHaveCount(1);

    const desktopGeometry = await page.evaluate(() => {
        const row = document.querySelector('#period_panel > .backtest-shared-select-row');
        const trigger = document.querySelector('#period_panel [data-shared-select-trigger]');
        const form = document.querySelector('form.portfolio-controls');
        if (!row || !trigger || !form) return null;
        const token = Number.parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue('--settings-form-control-max-width'));
        return {
            token,
            rowWidth: row.getBoundingClientRect().width,
            triggerWidth: trigger.getBoundingClientRect().width,
            formWidth: form.getBoundingClientRect().width,
        };
    });
    expect(desktopGeometry).not.toBeNull();
    expect(desktopGeometry?.token).toBe(384);
    expect(desktopGeometry?.rowWidth).toBeCloseTo(desktopGeometry?.triggerWidth, 5);
    expect(desktopGeometry?.rowWidth).toBeLessThanOrEqual(desktopGeometry?.token + 0.5);
    expect(desktopGeometry?.rowWidth).toBeLessThanOrEqual(desktopGeometry?.formWidth + 0.5);

    await periodTrigger.click();
    await expect(periodDropdown).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const trigger = document.querySelector('#period_panel [data-shared-select-trigger]');
        const dropdown = document.querySelector('#period_dropdown');
        if (!trigger || !dropdown) return Number.POSITIVE_INFINITY;
        return Math.abs(trigger.getBoundingClientRect().width - dropdown.getBoundingClientRect().width);
    })).toBeLessThan(0.01);

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    const narrowGeometry = await page.evaluate(() => {
        const row = document.querySelector('#period_panel > .backtest-shared-select-row');
        const trigger = document.querySelector('#period_panel [data-shared-select-trigger]');
        const form = document.querySelector('form.portfolio-controls');
        if (!row || !trigger || !form) return null;
        return {
            rowWidth: row.getBoundingClientRect().width,
            triggerWidth: trigger.getBoundingClientRect().width,
            formWidth: form.getBoundingClientRect().width,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    expect(narrowGeometry).not.toBeNull();
    expect(narrowGeometry?.rowWidth).toBeCloseTo(narrowGeometry?.triggerWidth, 5);
    expect(narrowGeometry?.rowWidth).toBeLessThanOrEqual(320.5);
    expect(narrowGeometry?.rowWidth).toBeLessThanOrEqual(narrowGeometry?.formWidth + 0.5);
    expect(narrowGeometry?.documentOverflow).toBeLessThanOrEqual(1);
});

test('remembers return and Ticker comparison state while switching workspaces', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    await page.getByRole('link', {name: 'Ticker comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/prices\?ticker=QQQ&ticker=AAPL$/);

    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=5y');
    await page.getByRole('link', {name: 'Return comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/compare\?ticker=QQQ&ticker=AAPL$/);

    await page.getByRole('link', {name: 'Ticker comparison'}).click();
    await expect(page).toHaveURL(/\/workspaces\/prices\?ticker=DRAM&ticker=MU&ticker=STX&range=5y$/);
});

test('renders cross-market one-day returns as visible lines', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('#returnsChart'))));

    const renderState = await page.evaluate(() => {
        history.replaceState({}, '', '/workspaces/compare?ticker=0005.HK&ticker=HSBA.L&ticker=HSBC&period=1d');
        const dates = ['09:30', '10:30', '11:30', '12:30'];
        const rawDates = [
            '2026-07-09 21:30',
            '2026-07-10 03:30',
            '2026-07-10 09:30',
            '2026-07-10 10:30',
        ];
        const tickers = ['5.HK', 'HSBA.L', 'HSBC'];
        window.WORTHWARD_APP.chart = {
            profiles: tickers.map((ticker) => ({ticker, company_name: ticker, logo_url: null})),
            series: tickers.map((ticker, index) => ({
                ticker,
                dates,
                raw_dates: rawDates,
                normalized_returns: [index, index + 0.5, index + 1, index + 1.5],
                candlestick_returns: dates.map((_, candleIndex) => ({
                    x: candleIndex,
                    o: index + candleIndex,
                    h: index + candleIndex + 0.75,
                    l: index + candleIndex - 0.25,
                    c: index + candleIndex + 0.5,
                })),
                color: ['#0055cc', '#7f42af', '#ff2f92'][index],
                glow: true,
            })),
            tradingDate: '2026-07-10',
        };
        window.WORTHWARD_BOOTSTRAP.initChartWorkspace();
        const canvas = document.querySelector('#returnsChart');
        const chart = window.Chart.getChart(canvas);
        return {
            mode: canvas.dataset.chartRenderMode,
            datasets: chart.data.datasets.map((dataset) => ({
                showLine: dataset.showLine,
                finiteValues: dataset.data.filter((value) => Number.isFinite(value)).length,
            })),
        };
    });

    expect(renderState.mode).toBe('line');
    expect(renderState.datasets).toHaveLength(3);
    expect(renderState.datasets.every((dataset) => dataset.showLine && dataset.finiteValues === 4)).toBe(true);
});

test('commits and loads a clicked ticker suggestion', async ({page}) => {
    await page.route('**/api/symbol-search?q=D*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    symbol: 'DRAM',
                    name: 'Roundhill Memory ETF',
                    logo_url: '/api/market-store/logos/DRAM.png',
                    source: 'local',
                },
            ]),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_1');
    await input.fill('D');
    await page.locator('#ticker_1_suggestions .suggestion-item', {hasText: 'DRAM'}).click();

    await expect(page).toHaveURL(/ticker=DRAM/);
    await expect(page.locator('#ticker_1')).toHaveValue('DRAM');
});

test('keeps a valid ticker lookup visible with fetching feedback', async ({page}) => {
    let releaseLookup;
    const lookupGate = new Promise((resolve) => {
        releaseLookup = resolve;
    });
    await page.route('**/api/symbol-search?q=spy*', async (route) => {
        await lookupGate;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([{
                symbol: 'SPY',
                name: 'SPDR S&P 500 ETF Trust',
                logo_url: '/api/market-store/logos/SPY.png',
                source: 'remote',
            }]),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1d');

    await page.locator('#ticker_2').fill('spy');
    const status = page.locator('#ticker_2_suggestions .suggestion-loading');
    await expect(status).toHaveText('Fetching SPY…');

    releaseLookup();
    await expect(status).toBeHidden();
});

test('keeps prefix and exact ticker suggestions open until selection or Enter', async ({page}) => {
    const appleSuggestion = {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        logo_url: '/market-store/logos/AAPL.svg',
        source: 'local',
    };
    await page.route('**/api/symbol-search?q=AA*', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        const payload = query === 'AA'
            ? [{symbol: 'AA', name: 'Alcoa Corporation', source: 'remote'}, appleSuggestion]
            : query === 'AAP'
                ? [{symbol: 'AAP', name: 'Advance Auto Parts, Inc.', source: 'remote'}, appleSuggestion]
                : [appleSuggestion];
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(payload),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_1');
    const appleItem = page.locator('#ticker_1_suggestions .suggestion-item[data-symbol="AAPL"]');

    await input.fill('AA');
    await expect(appleItem).toBeVisible();

    await input.fill('AAP');
    await expect(appleItem).toBeVisible();

    const urlBeforeExactInput = page.url();
    await input.fill('AAPL');
    await expect(appleItem).toBeVisible();
    await expect(appleItem).toContainText('Apple Inc.');
    const appleLogo = appleItem.locator('img.suggestion-logo');
    await expect(appleLogo).toHaveCount(1);
    await expect(appleLogo).toHaveAttribute('src', '/market-store/logos/AAPL.svg');
    await page.waitForTimeout(150);
    expect(page.url()).toBe(urlBeforeExactInput);

    await input.press('Enter');
    await expect(page).toHaveURL(/ticker=AAPL/, {timeout: 10_000});
});

test('draws no return zero baseline for a market-cap chart', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');

    const chartState = await page.evaluate(() => {
        const state = window.WORTHWARD_APP;
        state.currentView = 'prices';
        state.comparisonMetric = 'market-cap';
        state.chart = {
            ...state.chart,
            profiles: [],
            series: [{
                ticker: 'QQQ',
                dates: ['1 Jan 2026', '2 Jan 2026'],
                raw_dates: ['2026-01-01 00:00', '2026-01-02 00:00'],
                normalized_returns: [0, 1],
                market_caps: [100_000_000_000, 120_000_000_000],
                color: '#0055cc',
            }],
        };
        window.WORTHWARD_BOOTSTRAP.initChartWorkspace();
        const chart = window.Chart.getChart(document.querySelector('#returnsChart'));
        const zeroBandPlugin = chart.config._config.plugins.find((plugin) => plugin.id === 'zeroBandPlugin');
        const calls = [];
        zeroBandPlugin.beforeDatasetsDraw({
            ctx: {
                save: () => calls.push('save'),
                beginPath: () => calls.push('beginPath'),
                moveTo: () => calls.push('moveTo'),
                lineTo: () => calls.push('lineTo'),
                stroke: () => calls.push('stroke'),
                restore: () => calls.push('restore'),
            },
            chartArea: {left: 0, right: 100},
            scales: {y: {getPixelForValue: () => 50}},
        });
        return {
            zeroBandCalls: calls,
            xBorderVisible: chart.options.scales.x.border.display,
        };
    });

    expect(chartState.zeroBandCalls).toEqual([]);
    expect(chartState.xBorderVisible).toBe(false);
});

test('formats market-cap y-axis values without fixed trailing zeroes', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');
    await page.waitForFunction(() => Boolean(window.Chart?.getChart?.(document.querySelector('#returnsChart'))));

    const formattedTicks = await page.evaluate(() => {
        const state = window.WORTHWARD_APP;
        state.currentView = 'prices';
        state.comparisonMetric = 'market-cap';
        state.chart = {
            ...state.chart,
            profiles: [],
            series: [{
                ticker: 'QQQ',
                dates: ['1 Jan 2026', '2 Jan 2026'],
                raw_dates: ['2026-01-01 00:00', '2026-01-02 00:00'],
                normalized_returns: [0, 1],
                market_caps: [1_234, 4_500_000_000_000],
                color: '#0055cc',
            }],
        };
        window.WORTHWARD_BOOTSTRAP.initChartWorkspace();
        const chart = window.Chart.getChart(document.querySelector('#returnsChart'));
        const callback = chart.options.scales.y.ticks.callback;
        const ticks = [{value: 1_000}, {value: 1_234}, {value: 1_500}];
        return [
            callback(1_234, 1, ticks),
            callback(4_500_000_000_000, 1, ticks),
            callback(4_000_000_000_000, 1, ticks),
        ];
    });

    expect(formattedTicks).toEqual(['1,234', '4.5T', '4T']);
});

test('omits midnight from long market-cap x-axis labels', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=6mo');

    const axisLabels = await page.evaluate(() => {
        const state = window.WORTHWARD_APP;
        const rawDates = Array.from({length: 10}, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')} 00:00`);
        const series = {
            ticker: 'QQQ',
            dates: rawDates,
            raw_dates: rawDates,
            normalized_returns: rawDates.map((_value, index) => index),
            market_caps: rawDates.map((_value, index) => 100_000_000_000 + (index * 1_000_000_000)),
            color: '#0055cc',
        };
        const renderAxisLabels = (period) => {
            window.history.replaceState({}, '', `/workspaces/prices?metric=market-cap&ticker=QQQ&ticker=JEPQ&period=${period}`);
            state.currentView = 'prices';
            state.comparisonMetric = 'market-cap';
            state.chart = {...state.chart, profiles: [], series: [series]};
            window.WORTHWARD_BOOTSTRAP.initChartWorkspace();
            const canvas = document.querySelector('#returnsChart');
            const chart = window.Chart.getChart(canvas);
            const plugin = chart.config._config.plugins.find((item) => item.id === 'xAxisLabelPlugin');
            const calls = [];
            plugin.afterDraw({
                ctx: {
                    save: () => {},
                    restore: () => {},
                    fillText: (text) => calls.push(String(text)),
                },
                chartArea: {bottom: 200, left: 0, width: 400},
                scales: {x: {getPixelForValue: (value) => Number(value) * 40}},
            });
            return calls;
        };
        return {
            oneWeekRange: renderAxisLabels('1w'),
            longRange: renderAxisLabels('6mo'),
            shortRange: renderAxisLabels('3d'),
        };
    });

    expect(axisLabels.oneWeekRange).not.toContain('2026 00:00');
    expect(axisLabels.longRange).not.toContain('2026 00:00');
    expect(axisLabels.longRange).toContain('2026');
    expect(axisLabels.shortRange).toContain('2026 00:00');
});

test('keeps an inferred numeric market symbol as a user-confirmed suggestion', async ({page}) => {
    await page.route('**/api/symbol-search?q=660*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    symbol: '000660.KS',
                    name: 'SK hynix Inc.',
                    logo_url: '/market-store/logos/000660.KS.svg',
                    source: 'local',
                },
            ]),
        });
    });
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=5y');
    const input = page.locator('#ticker_1');
    await input.fill('660');

    const suggestion = page.locator('#ticker_1_suggestions .suggestion-item', {hasText: '000660.KS'});
    await expect(input).toHaveValue('660');
    await expect(suggestion).toBeVisible();
    await expect(page).toHaveURL(/ticker=QQQ/);

    await suggestion.click();
    await expect(page).toHaveURL(/ticker=000660\.KS/, {timeout: 10_000});
    await expect(page.locator('#ticker_1')).toHaveValue('000660.KS');
});

test('keeps exact-date pickers inside the viewport and clickable', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=1d');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    await page.getByRole('textbox', {name: 'Type trading date'}).click();

    const popover = page.locator('.date-picker-popover:not([hidden])');
    await expect(popover).toBeVisible();
    const geometry = await popover.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            top: rect.top,
            bottom: rect.bottom,
            viewportHeight: window.visualViewport?.height || window.innerHeight,
        };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);

    const modeOverlap = await page.locator('.range-mode-shell').evaluate((modeShell, visiblePopover) => {
        const modeRect = modeShell.getBoundingClientRect();
        const popoverRect = visiblePopover.getBoundingClientRect();
        return !(
            popoverRect.right <= modeRect.left
            || popoverRect.left >= modeRect.right
            || popoverRect.bottom <= modeRect.top
            || popoverRect.top >= modeRect.bottom
        );
    }, await popover.elementHandle());
    expect(modeOverlap).toBe(false);
    await page.locator('.range-mode-shell label[for="range_period"]').click();
    await expect(page.locator('#range_period')).toBeChecked();
    await expect(popover).toBeHidden();
    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await expect(popover).toBeVisible();

    await page.locator('.price-subplots-surface').click({position: {x: 12, y: 12}});
    await expect(popover).toBeHidden();
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await expect(popover).toBeVisible();

    const selectedValue = await page.locator('#exact_trading_date').inputValue();
    const dateButton = popover.locator(`.date-picker-day[data-value="${selectedValue}"]`);
    await expect(dateButton).toHaveAttribute('data-selectable', 'true');
    await dateButton.click();
    await expect(popover).toBeHidden();
    await expect(page.locator('#exact_trading_date')).toHaveValue(selectedValue);
});

test('renders Compare exact-date values at regular weight', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&range=exact&from=2025-08-14&to=2026-08-14');
    await expect(page.locator('#exact_panel')).toBeVisible();

    const weights = await page.locator('#exact_panel [data-exact-range-date-grid]:not([hidden]) [data-date-trigger-value]').evaluateAll((values) => (
        values.map((value) => getComputedStyle(value).fontWeight)
    ));
    expect(weights).toEqual(['400', '400']);
});

test('switches an untouched range mode without submitting or desynchronizing its pill', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1d');
    const rangeShell = page.locator('.range-mode-shell');
    const form = page.locator('form.controls');
    await form.evaluate((element) => {
        element.dataset.rangeModeSubmitCount = '0';
        element.addEventListener('submit', (event) => {
            event.preventDefault();
            element.dataset.rangeModeSubmitCount = String(
                Number.parseInt(element.dataset.rangeModeSubmitCount || '0', 10) + 1,
            );
        }, {capture: true});
    });
    const urlBeforeToggle = page.url();

    await rangeShell.locator('label[for="range_exact"]').click();
    await expect(page.locator('#range_exact')).toBeChecked();
    await expect(rangeShell).toHaveAttribute('data-active', 'exact');
    await expect(page.locator('#exact_panel')).toBeVisible();

    await rangeShell.locator('label[for="range_period"]').click();
    await expect(page.locator('#range_period')).toBeChecked();
    await expect(rangeShell).toHaveAttribute('data-active', 'period');
    await expect(page.locator('#period_panel')).toBeVisible();
    await page.waitForTimeout(350);

    expect(page.url()).toBe(urlBeforeToggle);
    await expect.poll(() => form.evaluate((element) => element.dataset.rangeModeSubmitCount)).toBe('0');
    const pillState = await rangeShell.evaluate((element) => ({
        activeIndex: element.style.getPropertyValue('--segmented-active-index'),
        overflow: element.dataset.segmentedOverflow,
        activeLabelColor: getComputedStyle(element.querySelector('.segmented-control-option:first-child span')).color,
        inactiveLabelColor: getComputedStyle(element.querySelector('.segmented-control-option:last-child span')).color,
    }));
    expect(pillState.activeIndex).toBe('0');
    expect(pillState.overflow).toBe('0');
    expect(pillState.activeLabelColor).not.toBe(pillState.inactiveLabelColor);
});

test('pre-fills Exact with the rendered multi-day market-cap range', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=6mo');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    const expectedRange = await page.evaluate(() => {
        const dates = window.WORTHWARD_APP.chart.series[0].raw_dates;
        return {
            start: String(dates[0]).slice(0, 10),
            end: String(dates[dates.length - 1]).slice(0, 10),
        };
    });

    await page.locator('.range-mode-shell label[for="range_exact"]').click();

    await expect(page.locator('#exact_start')).toHaveValue(expectedRange.start);
    await expect(page.locator('#exact_end')).toHaveValue(expectedRange.end);
    expect(expectedRange.start).not.toBe(expectedRange.end);
});

test('retains rendered exact-date labels after a market-cap page reload', async ({page}) => {
    const exactUrl = '/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&range=exact&period=6mo&from=2026-01-20&to=2026-07-24';

    await page.goto(exactUrl);
    const startEditor = page.getByRole('textbox', {name: 'Type start date'});
    const endEditor = page.getByRole('textbox', {name: 'Type end date'});
    const initialValues = {
        start: await page.locator('#exact_start').inputValue(),
        end: await page.locator('#exact_end').inputValue(),
        startLabel: await startEditor.textContent(),
        endLabel: await endEditor.textContent(),
    };
    const expectedLabels = await page.evaluate(() => {
        const formatDate = (inputId) => {
            const [year, month, day] = String(document.querySelector(inputId)?.value || '')
                .split('-')
                .map((value) => Number.parseInt(value, 10));
            return window.WORTHWARD_BOOTSTRAP.dateDisplay.formatFullDateParts({
                year,
                monthIndex: month - 1,
                day,
            });
        };
        return {
            start: formatDate('#exact_start'),
            end: formatDate('#exact_end'),
        };
    });
    expect(initialValues.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(initialValues.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(initialValues.startLabel).toBe(expectedLabels.start);
    expect(initialValues.endLabel).toBe(expectedLabels.end);

    await page.reload();
    await expect(page.locator('#exact_start')).toHaveValue(initialValues.start);
    await expect(page.locator('#exact_end')).toHaveValue(initialValues.end);
    await expect(startEditor).toHaveText(initialValues.startLabel || '');
    await expect(endEditor).toHaveText(initialValues.endLabel || '');
});

test('submits a selected custom Period option for market-cap comparison', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1w');
    const periodTrigger = page.locator('[data-shared-select-trigger]');
    await periodTrigger.click();
    const periodListbox = page.getByRole('listbox', {name: 'Period', exact: true});
    await Promise.all([
        page.waitForURL((url) => url.searchParams.get('range') === '2y'),
        periodListbox.getByRole('option', {name: '2 years', exact: true}).click(),
    ]);

    await expect(page.locator('#period')).toHaveValue('2y');
    await expect(page.getByRole('button', {name: 'Period: 2 years', exact: true})).toBeVisible();
    await page.locator('#add_ticker').click();
    await expect(page.locator('#ticker_3')).toBeVisible();
});

test('switches exact-date pickers into a bounded year grid with explanatory disabled months', async ({page}) => {
    await page.route('**/api/date-constraints*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                min_date: '2022-05-23',
                max_date: '2026-07-14',
                trading_dates: ['2022-05-23', '2022-05-24', '2026-07-14'],
                adjusted_start: '2026-07-14',
                adjusted_end: '2026-07-14',
                message: null,
                availability: {
                    earliest: {message: 'JEPQ has no comparable history before 23 May 2022.'},
                    latest: {message: 'AAPL has no comparable history after 14 Jul 2026.'},
                },
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=AAPL&period=1d');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });
    await page.locator('.range-mode-shell label[for="range_exact"]').click();
    const input = page.locator('#exact_trading_date');
    await expect.poll(() => input.evaluate((element) => element.min)).toBe('2022-05-23');
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await page.locator('.date-picker-popover:not([hidden]) [data-date-title]').click();

    const monthGrid = page.locator('[data-date-month-grid]:not([hidden])');
    await expect(monthGrid).toBeVisible();
    await expect(monthGrid.locator('.date-picker-month')).toHaveCount(12);
    await expect(monthGrid.locator('[data-month-value="2026-08"]')).toHaveAttribute('data-selectable', 'false');
    const popover = page.locator('.date-picker-popover:not([hidden])');
    await popover.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
    const heightBeforeFeedback = await popover.evaluate((element) => element.getBoundingClientRect().height);
    await monthGrid.locator('[data-month-value="2026-08"]').click();
    await expect(page.locator('#exact_trading_date_feedback')).toContainText('AAPL has no comparable history after 14 Jul 2026.');
    await expect.poll(() => popover.evaluate((element) => element.getBoundingClientRect().height)).toBe(heightBeforeFeedback);

    for (let index = 0; index < 4; index += 1) {
        await page.getByRole('button', {name: 'Previous year'}).click();
    }
    await expect(monthGrid.locator('[data-month-value="2022-04"]')).toHaveAttribute('data-selectable', 'false');
    await expect(monthGrid.locator('[data-month-value="2022-05"]')).toHaveAttribute('data-selectable', 'true');
    await monthGrid.locator('[data-month-value="2022-04"]').click();
    await expect(page.locator('#exact_trading_date_feedback')).toContainText('JEPQ has no comparable history before 23 May 2022.');
    await monthGrid.locator('[data-month-value="2022-05"]').click();
    await expect(page.locator('.date-picker-popover:not([hidden]) [data-date-calendar]:not([hidden])')).toBeVisible();
});

test('allows the current US premarket date for an exact one-day comparison', async ({page}) => {
    await page.route('**/api/date-constraints*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                min_date: '2026-04-15',
                max_date: '2026-08-24',
                trading_dates: ['2026-04-15', '2026-08-21', '2026-08-24'],
                adjusted_start: '2026-08-24',
                adjusted_end: '2026-08-24',
                message: null,
                availability: {
                    latest: {message: 'Current US session data is available for the selected tickers.'},
                },
            }),
        });
    });
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=MSFT&range=exact&period=1d&date=2026-08-24');

    const input = page.locator('#exact_trading_date');
    await expect.poll(() => input.inputValue()).toBe('2026-08-24');
    await expect.poll(() => input.evaluate((element) => element.max)).toBe('2026-08-24');
    await page.getByRole('textbox', {name: 'Type trading date'}).click();
    await page.locator('.date-picker-popover:not([hidden]) [data-date-title]').click();
    const monthGrid = page.locator('[data-date-month-grid]:not([hidden])');
    await expect(monthGrid.locator('[data-month-value="2026-08"]')).toHaveAttribute('data-selectable', 'true');
    await monthGrid.locator('[data-month-value="2026-08"]').click();
    await expect(
        page.locator('.date-picker-popover:not([hidden]) [data-date-calendar]:not([hidden]) [data-value="2026-08-24"]'),
    ).toHaveAttribute('data-selectable', 'true');
});

test('keeps manual date drafts neutral and reserves feedback for complete unavailable dates', async ({page}) => {
    await page.route('**/api/date-constraints*', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                min_date: '2025-07-01',
                max_date: '2025-07-31',
                trading_dates: ['2025-07-03', '2025-07-07', '2025-07-17', '2025-07-18', '2025-07-21', '2025-07-29'],
                adjusted_start: '2025-07-17',
                adjusted_end: '2025-07-29',
                message: null,
                availability: {},
            }),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&range=exact&period=1y&from=2025-07-17&to=2025-07-29');
    await page.locator('form.controls').evaluate((form) => {
        form.addEventListener('submit', (event) => event.preventDefault(), {capture: true});
    });

    const editor = page.getByRole('textbox', {name: 'Type start date'});
    await editor.click();
    await editor.press('ControlOrMeta+A');
    await editor.press('Backspace');
    for (const character of '17 Jul 2025') {
        await editor.pressSequentially(character);
        await expect(editor).toHaveAttribute('aria-invalid', 'false');
    }
    await expect(page.locator('#exact_start_feedback')).toBeEmpty();

    await editor.press('ControlOrMeta+A');
    await editor.pressSequentially('4 Jul 2025');
    await expect(editor).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#exact_start_feedback')).toContainText('Choose a shared trading day for the selected tickers.');
});

test('keeps price subplot dates only on the bottom New York axis', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=1y');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));

    const axisVisibility = await page.locator('[data-price-subplot-canvas]').evaluateAll((canvases) => (
        canvases.map((canvas) => window.Chart.getChart(canvas).options.scales.x.display)
    ));
    expect(axisVisibility).toEqual([false, false, true]);
});

test('formats every price-comparison y axis with the shared stock-price contract', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=QQQ&ticker=SPY&period=1y');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));

    const highPriceContract = await page.locator('[data-price-subplot-canvas]').first().evaluate((canvas) => {
        const chart = window.Chart.getChart(canvas);
        const callback = chart.options.scales.y.ticks.callback;
        return {
            helperVersion: window.WORTHWARD_CHART_AXIS?.CHART_AXIS_UTILS_VERSION || '',
            samples: [1234, 567, 12.5, 5.5].map((value) => callback(value, 1, [{}, {}, {}])),
            labels: chart.scales.y.ticks.map((tick) => String(tick.label ?? '')).filter(Boolean),
        };
    });
    expect(highPriceContract.helperVersion).toBe('v1.7.0');
    expect(highPriceContract.samples).toEqual(['1,234', '567', '12.50', '5.50']);
    expect(highPriceContract.labels.every((label) => /^-?\d{1,3}(?:,\d{3})*$/.test(label))).toBe(true);

    await page.goto('/workspaces/prices?ticker=DRAM&ticker=SKHY&period=6mo');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));
    const lowPriceLabels = await page.locator('[data-price-subplot][data-ticker="DRAM"] [data-price-subplot-canvas]').evaluate((canvas) => (
        window.Chart.getChart(canvas).scales.y.ticks
            .map((tick) => String(tick.label ?? ''))
            .filter(Boolean)
    ));
    expect(lowPriceLabels.length).toBeGreaterThan(0);
    expect(lowPriceLabels.every((label) => {
        const numericValue = Number(label.replaceAll(',', ''));
        return Math.abs(numericValue) >= 100
            ? /^-?\d{1,3}(?:,\d{3})*$/.test(label)
            : /^-?\d{1,2}\.\d{2}$/.test(label);
    })).toBe(true);
});

test('connects daily price points across market-calendar gaps without filling missing history', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=000660.KS&ticker=SKHY&ticker=DRAM&range=6mo');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));

    const dailyGapContract = await page.evaluate(() => {
        const series = window.WORTHWARD_APP.chart.series;
        const target = series.find((item) => item.ticker === '000660.KS') || series[0];
        const prices = [...target.prices];
        const gapIndex = prices.findIndex((value, index) => (
            index > 0
            && index < prices.length - 1
            && value !== null
            && prices[index - 1] !== null
            && prices[index + 1] !== null
        ));
        if (gapIndex < 0) throw new Error('The fixture needs three adjacent daily price points.');
        prices[gapIndex] = null;
        target.prices = prices;
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();
        const canvas = document.querySelector('[data-price-subplot-canvas]');
        const chart = window.Chart.getChart(canvas);
        return {
            gapIndex,
            before: chart.data.datasets[0].data[gapIndex - 1],
            gap: chart.data.datasets[0].data[gapIndex],
            after: chart.data.datasets[0].data[gapIndex + 1],
            spanGaps: chart.data.datasets[0].spanGaps,
        };
    });

    expect(dailyGapContract.gapIndex).toBeGreaterThan(0);
    expect(dailyGapContract.before).not.toBeNull();
    expect(dailyGapContract.gap).toBeNull();
    expect(dailyGapContract.after).not.toBeNull();
    expect(dailyGapContract.spanGaps).toBe(true);
});

test('keeps the bottom price axis on the shared range when its ticker starts later', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=AAPL&ticker=QQQ&ticker=MU&ticker=DRAM&ticker=STX&range=6mo');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));

    const sharedRangeAxis = await page.evaluate(() => {
        const series = window.WORTHWARD_APP.chart.series;
        const bottomIndex = series.length - 1;
        const lateStartIndex = Math.max(1, Math.floor(series[bottomIndex].prices.length * 0.7));
        window.WORTHWARD_APP.chart.series = series.map((item, index) => index === bottomIndex ? {
            ...item,
            prices: item.prices.map((value, priceIndex) => priceIndex < lateStartIndex ? null : value),
        } : item);
        window.WORTHWARD_BOOTSTRAP.initPriceCompareWorkspace();

        const canvases = [...document.querySelectorAll('[data-price-subplot-canvas]')];
        const topChart = window.Chart.getChart(canvases[0]);
        const bottomCanvas = canvases.at(-1);
        const bottomChart = window.Chart.getChart(bottomCanvas);
        const lastIndex = bottomChart.data.labels.length - 1;
        const topCallback = topChart.options.scales.x.ticks.callback;
        const bottomCallback = bottomChart.options.scales.x.ticks.callback;
        return {
            visibility: canvases.map((canvas) => window.Chart.getChart(canvas).options.scales.x.display),
            firstValidIndex: bottomChart.data.datasets[0].data.findIndex((value) => value !== null),
            startLabel: bottomCallback(0, 0),
            expectedStartLabel: topCallback(0, 0),
            lateStartLabel: bottomCallback(lateStartIndex, lateStartIndex),
            endLabel: bottomCallback(lastIndex, lastIndex),
            expectedEndLabel: topCallback(lastIndex, lastIndex),
            labelBasis: bottomCanvas.dataset.xAxisLabelBasis,
            rangeStart: bottomCanvas.dataset.xAxisRangeStart,
            rangeEnd: bottomCanvas.dataset.xAxisRangeEnd,
            sharedStart: series[0].raw_dates[0],
            sharedEnd: series[0].raw_dates.at(-1),
        };
    });

    expect(sharedRangeAxis.visibility).toEqual([false, false, false, false, true]);
    expect(sharedRangeAxis.firstValidIndex).toBeGreaterThan(0);
    expect(sharedRangeAxis.startLabel).toBe(sharedRangeAxis.expectedStartLabel);
    expect(sharedRangeAxis.lateStartLabel).toBe('');
    expect(sharedRangeAxis.endLabel).toBe(sharedRangeAxis.expectedEndLabel);
    expect(sharedRangeAxis.labelBasis).toBe('shared-range');
    expect(sharedRangeAxis.rangeStart).toBe(sharedRangeAxis.sharedStart);
    expect(sharedRangeAxis.rangeEnd).toBe(sharedRangeAxis.sharedEnd);
});

test('reorders price subplots and ticker fields without recreating charts', async ({page}) => {
    const liveRequests = [];
    page.on('request', (request) => {
        if (request.url().includes('/api/compare/live')) liveRequests.push(request.url());
    });
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));
    await page.evaluate(() => {
        document.querySelectorAll('[data-price-subplot]').forEach((section) => {
            const canvas = section.querySelector('[data-price-subplot-canvas]');
            window.Chart.getChart(canvas).$orderIdentity = section.dataset.ticker;
        });
    });

    const firstSection = page.locator('[data-price-subplot][data-ticker="DRAM"]');
    const firstHandle = firstSection.locator('[data-price-subplot-order-handle]');
    const secondSection = page.locator('[data-price-subplot][data-ticker="MU"]');
    const firstBox = await firstSection.boundingBox();
    const secondBox = await secondSection.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    await page.mouse.move(firstBox.x + (firstBox.width * 0.25), firstBox.y + (firstBox.height / 2));
    await expect.poll(() => firstHandle.evaluate((handle) => getComputedStyle(handle, '::after').opacity)).toBe('0');
    const hiddenHandleShadow = await firstHandle.evaluate((handle) => getComputedStyle(handle, '::after').boxShadow);
    await page.mouse.move(firstBox.x + (firstBox.width * 0.75), firstBox.y + (firstBox.height / 2));
    await expect.poll(() => firstHandle.evaluate((handle) => getComputedStyle(handle, '::after').opacity)).toBe('1');

    const handleMaterial = await firstHandle.evaluate((handle) => {
        const handleRect = handle.getBoundingClientRect();
        const sectionRect = handle.closest('[data-price-subplot]').getBoundingClientRect();
        const canvas = handle.closest('[data-price-subplot]').querySelector('[data-price-subplot-canvas]');
        const canvasRect = canvas.getBoundingClientRect();
        const chart = window.Chart.getChart(canvas);
        const glass = getComputedStyle(handle, '::after');
        return {
            lineDisplay: getComputedStyle(handle, '::before').display,
            handleVisualLeft: handleRect.left + (handleRect.width / 2) - 6,
            logoRight: canvasRect.left + chart.chartArea.right + 30,
            touchWidth: Math.round(handleRect.width),
            backdropFilter: glass.backdropFilter || glass.webkitBackdropFilter,
            boxShadow: glass.boxShadow,
            transform: glass.transform,
        };
    });
    expect(handleMaterial.lineDisplay).toBe('none');
    expect(handleMaterial.handleVisualLeft).toBeGreaterThan(handleMaterial.logoRight);
    expect(handleMaterial.touchWidth).toBeGreaterThanOrEqual(48);
    expect(handleMaterial.backdropFilter).toContain('blur');
    expect(handleMaterial.boxShadow).not.toBe(hiddenHandleShadow);
    expect(handleMaterial.transform).not.toBe('none');

    const handleBox = await firstHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(
        handleBox.x + (handleBox.width / 2),
        secondBox.y + (secondBox.height * 0.75),
        {steps: 6},
    );
    await expect(firstSection).toHaveClass(/is-order-dragging/);
    await expect(page.locator('.is-order-insert-before, .is-order-insert-after')).toHaveCount(1);
    expect(await firstSection.evaluate((section) => getComputedStyle(section).transform)).not.toBe('none');
    await page.mouse.up();
    await expect.poll(() => page.locator('#ticker_fields [data-order-motion="y-z"]').count()).toBeGreaterThan(0);

    const orderState = await page.evaluate(() => ({
        subplots: [...document.querySelectorAll('[data-price-subplot]')].map((section) => section.dataset.ticker),
        fields: [...document.querySelectorAll('#ticker_fields [data-ticker-input]')].map((input) => input.value),
        series: window.WORTHWARD_APP.chart.series.map((item) => item.ticker),
        url: new URL(window.location.href).searchParams.getAll('ticker'),
        chartIdentity: [...document.querySelectorAll('[data-price-subplot]')].map((section) => {
            const canvas = section.querySelector('[data-price-subplot-canvas]');
            return window.Chart.getChart(canvas)?.$orderIdentity;
        }),
        axisVisibility: [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .map((canvas) => window.Chart.getChart(canvas).options.scales.x.display),
    }));
    expect(orderState).toEqual({
        subplots: ['MU', 'DRAM', 'STX'],
        fields: ['MU', 'DRAM', 'STX'],
        series: ['MU', 'DRAM', 'STX'],
        url: ['MU', 'DRAM', 'STX'],
        chartIdentity: ['MU', 'DRAM', 'STX'],
        axisVisibility: [false, false, true],
    });
    expect(liveRequests).toHaveLength(0);
});
