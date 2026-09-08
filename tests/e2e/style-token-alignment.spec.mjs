/* Code version: v1.5.0 */
import {expect, test} from '@playwright/test';

async function expectFieldTitle(locator) {
    await expect(locator).toHaveCSS('font-size', '15px');
    await expect(locator).toHaveCSS('font-weight', '400');
    await expect(locator).toHaveCSS('line-height', 'normal');
    await expect(locator).toHaveCSS('letter-spacing', 'normal');
    await expect(locator).toHaveCSS('color', 'rgb(11, 12, 12)');
}

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
        await expect(secondary).toHaveCSS('height', '32px');
        expect(await secondary.evaluate(e => e.getBoundingClientRect().width < e.parentElement.getBoundingClientRect().width)).toBe(true);
        const periodTrigger = page.locator('[data-style-token-card="shared-select-dropdown"] [data-shared-select-trigger]');
        await periodTrigger.click();
        const periodOption = page.locator('[data-style-token-card="shared-select-dropdown"] [role="option"][data-value="1y"]');
        await expect(periodOption).toHaveCSS('height', '36px');
        await expect(periodOption.locator('.trade-strategy-dropdown-text')).toHaveText('1 year');
        expect(await periodOption.locator('.trade-strategy-dropdown-text').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
        const tuneButton = page.locator('[data-style-token-strategy-tune-button]');
        const tunePanel = page.locator('[data-style-token-strategy-tuning-panel]');
        await expect(tuneButton).toHaveAttribute('aria-pressed', 'true');
        await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
        await expect(tuneButton).toHaveCSS('width', '30px');
        await expect(tuneButton.locator('.icon')).toHaveCSS('width', '14px');
        await expect(tunePanel).toHaveCSS('padding', '10px');
        await expect(tunePanel).toBeVisible();
        await page.locator('.style-token-strategy-tuning-label').click();
        await expect(tunePanel).toBeVisible();
        await tuneButton.click();
        await expect(tuneButton).toHaveAttribute('aria-pressed', 'false');
        await expect(tuneButton).toHaveAttribute('aria-expanded', 'false');
        await expect(tunePanel).toBeHidden();
        await tuneButton.click();
        await expect(tunePanel).toBeVisible();
        expect(await page.locator('[data-style-token-strategy-tuning]').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
        const metricLabel = page.locator('[data-style-token-card="workspace-metric-value"] .trade-metric-label');
        await expect(metricLabel).toHaveText('Total trades');
        await expect(metricLabel).toHaveCSS('font-size', '15px');
        await expect(metricLabel).toHaveCSS('font-weight', '400');
        await expect(metricLabel).toHaveCSS('line-height', 'normal');
        await expect(metricLabel).toHaveCSS('color', 'rgb(11, 12, 12)');
        await expectFieldTitle(page.locator('.style-token-scrollable-table thead th:nth-child(2)'));
        await expectFieldTitle(page.locator('.style-token-settings-input-label'));
        for (const id of ['modal-dialog', 'modal-dialog-banner-message']) {
            const surface = page.locator(`#${id} .style-token-modal-demo`);
            const close = page.locator(`#${id} .dismiss-button`);
            await expect(surface).toHaveCSS('padding', '12px');
            await expect(close).toHaveCSS('width', '24px');
            await expect(close).toHaveCSS('height', '24px');
            await expect(close).toHaveCSS('border-radius', '50%');
            const geometry = await surface.evaluate((node) => {
                const button = node.querySelector('.dismiss-button').getBoundingClientRect();
                const icon = node.querySelector('.workspace-modal-icon').getBoundingClientRect();
                const bounds = node.getBoundingClientRect();
                return {
                    centerTop: button.top + (button.height / 2) - bounds.top,
                    centerLeft: button.left + (button.width / 2) - bounds.left,
                    controlIconGap: icon.left - button.right,
                };
            });
            expect(Math.abs(geometry.centerTop - geometry.centerLeft)).toBeLessThanOrEqual(1);
            expect(geometry.controlIconGap).toBeGreaterThan(0);
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
