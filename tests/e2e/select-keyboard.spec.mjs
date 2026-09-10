/* Code version: v1.1.0 */
import {expect, test} from '@playwright/test';
import {openBacktestParameterOverlay} from './backtest-parameter-overlay-helper.mjs';

for (const width of [1024, 390]) {
  for (const cachedTemplate of [false, true]) {
    test(`shared selectors use DOM focus at ${width}px (cached template: ${cachedTemplate})`, async ({page}) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (cachedTemplate) {
            await page.route('**/workspaces/backtest?**', async route => {
                const response = await route.fetch();
                const body = (await response.text()).replace(/<script[^>]+src="[^"]*select-controller\.js[^"]*"[^>]*><\/script>/g, '');
                await route.fulfill({response, body});
            });
        }
        await page.setViewportSize({width, height: 900});
        await page.goto('/workspaces/backtest?strategy=grid-trading&interval=1d');
        await openBacktestParameterOverlay(page);
        for (const fieldSelector of ['#period_panel', '[data-shared-select-kind="strategy"]']) {
            const trigger = page.locator(fieldSelector).locator('[data-shared-select-trigger]');
            const menu = page.locator('#' + await trigger.getAttribute('aria-controls'));
            await trigger.press('ArrowDown');
            const selected = menu.locator('[aria-selected="true"]');
            await expect(selected).toBeFocused();
            await expect(trigger).not.toHaveAttribute('aria-activedescendant', /.+/);
            await selected.press('End');
            await expect(menu.locator('[role="option"]').last()).toBeFocused();
            await expect(selected).toHaveAttribute('aria-selected', 'true');
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(trigger).toBeFocused();
            await trigger.press('ArrowUp');
            await menu.locator('[aria-selected="true"]').press('Enter');
            await expect(menu).toBeHidden();
            await expect(trigger).toBeFocused();
            await trigger.press('Home');
            await expect(menu.locator('[role="option"]').first()).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(menu).toBeHidden();
            expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
            for (const dismiss of await page.getByRole('button', {name: 'Close notice', exact: true}).all()) {
                if (await dismiss.isVisible()) await dismiss.press('Enter');
            }
            await trigger.click();
            await expect(menu).toBeVisible();
            await page.locator('#ticker_1').click();
            await expect(menu).toBeHidden();
        }
        expect(errors).toEqual([]);
    });
  }
}
