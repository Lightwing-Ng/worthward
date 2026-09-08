/* Code version: v1.0.1 */
import {expect, test} from '@playwright/test';

async function expectFieldTitle(locator) {
    await expect(locator).toHaveCSS('font-size', '15px');
    await expect(locator).toHaveCSS('font-weight', '400');
    await expect(locator).toHaveCSS('line-height', 'normal');
    await expect(locator).toHaveCSS('letter-spacing', 'normal');
    await expect(locator).toHaveCSS('color', 'rgb(11, 12, 12)');
}

for (const width of [1024, 390]) {
    test(`field titles match the Agent reference at ${width}px`, async ({page}) => {
        test.setTimeout(90000);
        await page.setViewportSize({width, height: 863});

        await page.goto('/workspaces/backtest?fall=1.00', {waitUntil: 'domcontentloaded'});
        await expectFieldTitle(page.locator('.range-mode-field > label'));

        await page.goto('/workspaces/portfolio', {waitUntil: 'domcontentloaded'});
        await expectFieldTitle(page.locator('.portfolio-allocation-field > label'));
        await expectFieldTitle(page.locator('#period_panel > label'));

        await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc', {waitUntil: 'domcontentloaded'});
        await expectFieldTitle(page.locator(
            '.investment-broker-summary-selector-shell > .investment-broker-summary-selector-label',
        ));
        const brokerSelector = page.locator('.investment-broker-summary-selector-shell');
        if (width === 1024) {
            await expect(brokerSelector).toHaveCSS('width', '384px');
        } else {
            expect(await brokerSelector.evaluate(e => e.getBoundingClientRect().width)).toBeLessThanOrEqual(384);
        }

        await page.goto('/settings/about', {waitUntil: 'domcontentloaded'});
        await expectFieldTitle(page.locator('.about-heading').first());
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}
