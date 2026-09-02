/* Code version: v0.1.1 */
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

const readLabelAlignment = async (control) => control.evaluate((element) => (
    [...element.querySelectorAll('.segmented-control-option span')].map((span) => {
        const textRange = document.createRange();
        textRange.selectNodeContents(span);
        const textRect = textRange.getBoundingClientRect();
        const spanRect = span.getBoundingClientRect();
        return {
            label: span.textContent.trim(),
            horizontalDelta: Math.abs(
                (textRect.left + (textRect.width / 2))
                - (spanRect.left + (spanRect.width / 2)),
            ),
            verticalDelta: Math.abs(
                (textRect.top + (textRect.height / 2))
                - (spanRect.top + (spanRect.height / 2)),
            ),
        };
    })
));

const expectLabelsCentered = (labels) => {
    expect(labels.length).toBe(3);
    for (const label of labels) {
        expect(label.horizontalDelta, `${label.label} horizontal alignment`).toBeLessThanOrEqual(1);
        expect(label.verticalDelta, `${label.label} vertical alignment`).toBeLessThanOrEqual(1);
    }
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

test('centers Backtest history labels in selected and unselected states', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto(backtestUrl);

    const historyControl = page.locator('#backtest_history_view_segmented');
    await expect(historyControl).toBeVisible();
    await expect(historyControl.locator('.segmented-control-option span')).toHaveCount(3);
    expectLabelsCentered(await readLabelAlignment(historyControl));

    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(page.locator('#backtest_history_probability')).toBeChecked();
    expectLabelsCentered(await readLabelAlignment(historyControl));

    await page.setViewportSize({width: 390, height: 844});
    await page.reload();
    await expect(historyControl).toBeVisible();
    expectLabelsCentered(await readLabelAlignment(historyControl));

    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(page.locator('#backtest_history_probability')).toBeChecked();
    expectLabelsCentered(await readLabelAlignment(historyControl));
});
