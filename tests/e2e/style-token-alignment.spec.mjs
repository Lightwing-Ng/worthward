/* Code version: v1.0.1 */
import {expect, test} from '@playwright/test';

for (const width of [1024, 800, 390]) {
    test(`shared component annotations at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 863});
        await page.goto('/settings/style-tokens');
        await expect(page.locator('#workspace-article, #primary-inverted-button')).toHaveCount(0);
        await expect(page.getByText('Shared parameters and strategy actions', {exact: true})).toHaveCount(0);
        const controls = page.locator('.style-token-shared-select-shell .trade-strategy-select, .style-token-stepper-input');
        await expect(controls).toHaveCount(3);
        for (const control of await controls.all()) await expect(control).toHaveCSS('height', '30px');
        const secondary = page.locator('#secondary-button .style-token-demo > button');
        await expect(secondary).toHaveClass('secondary-button');
        await expect(secondary).toHaveCSS('font-size', '13px');
        expect(await secondary.evaluate(e => Math.abs(e.getBoundingClientRect().right - e.parentElement.getBoundingClientRect().right))).toBeLessThanOrEqual(1);
        await expect(secondary).toHaveCSS('height', '31px');
        expect(await secondary.evaluate(e => e.getBoundingClientRect().width < e.parentElement.getBoundingClientRect().width)).toBe(true);
        for (const id of ['modal-dialog', 'modal-dialog-banner-message']) {
            const close = page.locator(`#${id} .dismiss-button`);
            await page.mouse.move(0, 0);
            await expect(close).toHaveCSS('opacity', '0');
            await close.locator('..').hover();
            await expect(close).toHaveCSS('opacity', '1');
            await expect(close).toHaveCSS('color', 'rgb(200, 30, 30)');
            await page.mouse.move(0, 0);
            await close.focus();
            await expect(close).toHaveCSS('opacity', '1');
            await close.evaluate(e => e.blur());
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('touch users can discover dismiss actions without hover', async ({browser}) => {
    const context = await browser.newContext({hasTouch: true, isMobile: true, viewport: {width: 390, height: 863}});
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8699/settings/style-tokens');
    for (const close of await page.locator('.style-token-demo .dismiss-button').all()) {
        await expect(close).toHaveCSS('opacity', '1');
    }
    await context.close();
});
