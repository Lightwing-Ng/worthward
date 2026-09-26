/* Backtest share-control layout contract. Code version: v0.2.1 */
import {expect, test} from '@playwright/test';

const priceFieldShareUrl = (
    '/workspaces/backtest?ticker=DRAM&range=1y&strategy=lstm-price-field'
    + '&show_trade_details=0&compute_backend=CPU&lstm_epochs=1'
    + '&lstm_lookback=4&lstm_hidden_size=4&training_window=40'
);

const readShareGeometry = (page) => page.evaluate(() => {
    const button = document.querySelector('#export_transactions_button');
    const drawer = button?.closest('[data-share-drawer="backtest"]');
    const resultCard = document.querySelector('.backtest-trade-performance-card');
    const chartHeading = document.querySelector('.backtest-surface > .chart-heading-row');
    const theme = document.querySelector('#global_theme_toggle');
    const rect = (element) => element?.getBoundingClientRect();
    const share = rect(button);
    const card = rect(resultCard);
    const heading = rect(chartHeading);
    const themeRect = rect(theme);
    const overlaps = (first, second) => Boolean(
        first
        && second
        && first.left < second.right
        && first.right > second.left
        && first.top < second.bottom
        && first.bottom > second.top,
    );
    return {
        drawerIsCardChild: drawer?.parentElement === resultCard,
        placement: drawer?.dataset.sharePlacement,
        shareInsideCard: Boolean(
            share
            && card
            && share.left >= card.left - 1
            && share.right <= card.right + 1
            && share.top >= card.top - 1
            && share.bottom <= card.bottom + 1,
        ),
        overlapsTheme: overlaps(share, themeRect),
        clearsChartHeading: Boolean(share && heading && share.bottom <= heading.top + 1),
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
});

const revealShareDrawer = async (page) => {
    await page.locator('[data-share-drawer="backtest"]').evaluate((element) => {
        element.hidden = false;
    });
};

const readPriceFieldShareCaptureGeometry = (page, {partialHorizons = false} = {}) => page.evaluate(async ({partialHorizons}) => {
    const sourceMetrics = document.querySelector('#backtest_metrics_panel');
    const sourceEvidenceDetail = sourceMetrics?.querySelector(
        '[data-backtest-metric="probability-field-forecast-evidence"] .trade-metric-detail',
    );
    if (!(sourceMetrics instanceof HTMLElement) || !(sourceEvidenceDetail instanceof HTMLElement)) {
        throw new Error('Price Field metrics are unavailable.');
    }

    let partialHorizonEvidence = null;
    if (partialHorizons) {
        partialHorizonEvidence = document.createElement('span');
        partialHorizonEvidence.textContent = '19 / 20 horizons scored';
        const intervalCoverage = Array.from(sourceEvidenceDetail.children).find(
            (element) => element.textContent?.includes('80% interval coverage'),
        );
        sourceEvidenceDetail.insertBefore(partialHorizonEvidence, intervalCoverage || null);
    }

    let capture = null;
    try {
        capture = await window.WORTHWARD_BOOTSTRAP.workspaceShare.buildTradeCard({
            shareView: 'backtest',
            title: 'Performance',
        });
    } finally {
        partialHorizonEvidence?.remove();
    }
    if (!(capture instanceof HTMLElement)) throw new Error('Backtest share capture is unavailable.');

    document.body.appendChild(capture);
    try {
        await document.fonts?.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const metrics = capture.querySelector('.workspace-share-metrics-card');
        const metricsSection = metrics?.parentElement;
        const firstChartSection = metricsSection?.nextElementSibling;
        if (!(metrics instanceof HTMLElement)
            || !(metricsSection instanceof HTMLElement)
            || !(firstChartSection instanceof HTMLElement)) {
            throw new Error('Backtest share sections are unavailable.');
        }
        const metricsSectionRect = metricsSection.getBoundingClientRect();
        const firstChartRect = firstChartSection.getBoundingClientRect();
        const metricCards = Array.from(metrics.children).filter(
            (element) => element.classList.contains('trade-metric-card'),
        );
        const detailRows = Array.from(metrics.querySelectorAll('.trade-metric-detail'));
        const metricRects = metricCards.map((card) => card.getBoundingClientRect());
        const columnCount = getComputedStyle(metrics).gridTemplateColumns
            .split(/\s+/)
            .filter(Boolean)
            .length;
        return {
            captureAriaHidden: capture.getAttribute('aria-hidden'),
            captureInert: capture.inert,
            sourceMetricPanelIdCount: document.querySelectorAll('#backtest_metrics_panel').length,
            cloneMetricPanelId: metrics.id,
            cloneAriaReferenceCount: metrics.querySelectorAll('[aria-labelledby], [aria-describedby]').length,
            columnCount,
            metricCount: metricCards.length,
            metricsClientHeight: metrics.clientHeight,
            metricsScrollHeight: metrics.scrollHeight,
            everyMetricInsideSection: metricRects.every((rect) => (
                rect.top >= metricsSectionRect.top - 1
                && rect.bottom <= metricsSectionRect.bottom + 1
            )),
            everyDetailFitsInline: detailRows.every(
                (detail) => detail.scrollWidth <= detail.clientWidth + 1,
            ),
            metricsClearFirstChart: Math.max(...metricRects.map((rect) => rect.bottom))
                <= firstChartRect.top + 1,
            metricsSectionClearsFirstChart: metricsSectionRect.bottom <= firstChartRect.top + 1,
            partialHorizonEvidenceCloned: metrics.textContent.includes('19 / 20 horizons scored'),
        };
    } finally {
        capture.remove();
    }
}, {partialHorizons});

test('keeps the Backtest output control inside its result card and clear of the theme control', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto('/workspaces/backtest?ticker=QQQ&range=6mo&strategy=buy-and-hold&show_trade_details=1');

    const shareButton = page.locator('#export_transactions_button');
    await revealShareDrawer(page);
    await expect(shareButton).toBeVisible();
    expect(await readShareGeometry(page)).toEqual(expect.objectContaining({
        drawerIsCardChild: true,
        placement: 'summary-panel',
        shareInsideCard: true,
        overlapsTheme: false,
        clearsChartHeading: true,
        noHorizontalOverflow: true,
    }));

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    await revealShareDrawer(page);
    await expect(shareButton).toBeVisible();
    expect(await readShareGeometry(page)).toEqual(expect.objectContaining({
        drawerIsCardChild: true,
        placement: 'summary-panel',
        shareInsideCard: true,
        overlapsTheme: false,
        clearsChartHeading: true,
        noHorizontalOverflow: true,
    }));
});

test('keeps complete and partial Price Field metrics inside the detached Backtest share card', async ({page}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto(priceFieldShareUrl);
    await expect(page.locator('[data-backtest-metric="probability-field-distribution-skill"]')).toBeAttached();
    await expect.poll(() => page.evaluate(() => (
        window.WORTHWARD_BOOTSTRAP?.workspaceShare?.areTradeChartsReady?.() === true
    )), {timeout: 120_000}).toBe(true);

    for (const partialHorizons of [false, true]) {
        const geometry = await readPriceFieldShareCaptureGeometry(page, {partialHorizons});
        expect(geometry).toEqual(expect.objectContaining({
            captureAriaHidden: 'true',
            captureInert: true,
            sourceMetricPanelIdCount: 1,
            cloneMetricPanelId: '',
            cloneAriaReferenceCount: 0,
            columnCount: 4,
            metricCount: 12,
            everyMetricInsideSection: true,
            everyDetailFitsInline: true,
            metricsClearFirstChart: true,
            metricsSectionClearsFirstChart: true,
            partialHorizonEvidenceCloned: partialHorizons,
        }));
        expect(geometry.metricsScrollHeight).toBeLessThanOrEqual(geometry.metricsClientHeight + 1);
    }
});
