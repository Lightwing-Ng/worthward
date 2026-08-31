/* Backtest share-control layout contract. Code version: v0.1.0 */
import {expect, test} from '@playwright/test';

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
