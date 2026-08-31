/* Code version: v0.1.0 */
import {expect, test} from '@playwright/test';

const backtestUrl = '/workspaces/backtest?ticker=MU&strategy=bayesian-price-field&stop_loss=0&show_trade_details=0&use_pe_ratio=0&use_market_temperature=1&use_capital_flow=1&use_short_interest=1&use_short_volume=1&training_window=200&compute_backend=GPU';
const backtestIntervalXPath = '/html/body/main/div/section/section/div/article[1]/form/div[5]/div';

const readCompactGeometry = async (control) => control.evaluate((element) => {
    const owner = element.parentElement;
    const controlRect = element.getBoundingClientRect();
    const ownerRect = owner?.getBoundingClientRect();
    const optionWidths = Array.from(element.querySelectorAll('.segmented-control-option, .range-mode-option'))
        .map((option) => option.getBoundingClientRect().width);
    return {
        controlWidth: controlRect.width,
        ownerWidth: ownerRect?.width ?? controlRect.width,
        centerDelta: ownerRect
            ? Math.abs((controlRect.left + (controlRect.width / 2)) - (ownerRect.left + (ownerRect.width / 2)))
            : Number.POSITIVE_INFINITY,
        optionWidths,
        overflow: element.scrollWidth > element.clientWidth + 1,
    };
});

const expectCompactGeometry = (geometry) => {
    expect(geometry.optionWidths.length).toBeGreaterThan(1);
    expect(geometry.controlWidth).toBeLessThan(geometry.ownerWidth - 1);
    expect(geometry.centerDelta).toBeLessThanOrEqual(1);
    expect(Math.max(...geometry.optionWidths) - Math.min(...geometry.optionWidths)).toBeLessThanOrEqual(1);
    expect(geometry.overflow).toBe(false);
};

test('keeps the shared mother specimen content-sized and centered', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/settings/style-tokens');

    const control = page.locator('[data-style-token-card="segmented-control"] .range-mode-shell');
    await expect(control).toBeVisible();
    expectCompactGeometry(await readCompactGeometry(control));

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    await expect(control).toBeVisible();
    expectCompactGeometry(await readCompactGeometry(control));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('keeps the supplied Backtest interval pill content-sized at desktop and narrow widths', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto(backtestUrl);

    const intervalControl = page.locator(`xpath=${backtestIntervalXPath}`);
    await expect(intervalControl).toHaveCount(1);
    await expect(intervalControl).toHaveId('backtest_interval_control');
    await expect(intervalControl).toBeVisible();
    expectCompactGeometry(await readCompactGeometry(intervalControl));

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    await expect(intervalControl).toBeVisible();
    expectCompactGeometry(await readCompactGeometry(intervalControl));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
