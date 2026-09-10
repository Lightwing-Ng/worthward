/* Backtest parameter overlay E2E helpers. Code version: v1.1.0 */
import {expect} from '@playwright/test';

export async function openBacktestParameterOverlay(page) {
    const toggle = page.locator('[data-backtest-parameter-toggle]');
    if (!await toggle.isVisible()) return false;

    await page.locator('[data-dismissible-notice]').evaluateAll((notices) => {
        notices.forEach((notice) => { notice.hidden = true; });
    });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();

    const panel = page.locator('[data-backtest-parameter-panel]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panel).toBeVisible();
    await panel.evaluate(async (element) => {
        await Promise.allSettled(
            element.getAnimations().map((animation) => animation.finished),
        );
    });
    await expect.poll(() => panel.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= window.innerWidth;
    })).toBe(true);
    return true;
}

export async function closeBacktestParameterOverlay(page) {
    const toggle = page.locator('[data-backtest-parameter-toggle]');
    if (!await toggle.isVisible() || await toggle.getAttribute('aria-expanded') !== 'true') return false;

    await toggle.click();
    const panel = page.locator('[data-backtest-parameter-panel]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(panel).toBeHidden();
    return true;
}
