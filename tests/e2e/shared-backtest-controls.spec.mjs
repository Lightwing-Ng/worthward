/* Shared Backtest control primitives. Code version: v1.0.0 */
import {test, expect} from '@playwright/test';

for (const colorScheme of ['light', 'dark']) {
    for (const width of [1024, 390]) {
        test(`shared collapses and training actions at ${width}px in ${colorScheme}`, async ({page}, testInfo) => {
            test.setTimeout(90_000);
            await page.setViewportSize({width, height: 900});
            await page.emulateMedia({colorScheme});
            await page.route('**/api/lstm-training', route => route.fulfill({json: {
                success: true, protocol_version: 2, runs: [{id: 'lstm-ga-aaaaaaaaaaaaaaaaaaaaaaaa',
                    ticker: 'NVDA', identifier: '260904(01)', status: 'completed', active: false,
                    accuracy_pct: 65, started_at: '2026-09-04T00:00:00Z'}],
            }}));
            await page.goto('/workspaces/backtest?strategy=lstm-price-field&show_trade_details=0');
            const common = page.locator('[data-collapse="backtest"]');
            const training = page.locator('[data-collapse="training"]');
            await expect(common.locator('#trade_initial_capital')).toBeVisible();
            await common.locator(':scope > summary').click();
            await expect(common.locator('#trade_initial_capital')).toBeHidden();
            await expect(common.locator('#show_trade_details')).toBeHidden();
            await expect(training.locator('details')).toHaveCount(0);
            const button = training.locator('[data-lstm-training-action]');
            await expect(button).toBeVisible();
            const geometry = await button.evaluate(node => ({
                width: node.getBoundingClientRect().width,
                parentWidth: node.parentElement.getBoundingClientRect().width,
                rightGap: node.parentElement.getBoundingClientRect().right - node.getBoundingClientRect().right,
            }));
            expect(geometry.width).toBeLessThan(geometry.parentWidth);
            expect(Math.abs(geometry.rightGap)).toBeLessThan(1);
            const entry = training.locator('.lstm-training-history-entry');
            const remove = entry.locator('[data-lstm-training-delete]');
            await page.mouse.move(width - 10, 10);
            await expect(remove).toHaveCSS('opacity', '0');
            await entry.hover();
            await expect(remove).toHaveCSS('opacity', '1');
            await remove.hover();
            const colors = await remove.evaluate(node => {
                const probe = document.createElement('i');
                probe.style.color = 'var(--theme-error)';
                node.appendChild(probe);
                const error = getComputedStyle(probe).color;
                probe.remove();
                return {background: getComputedStyle(node).backgroundColor, error};
            });
            await expect(remove).toHaveCSS('background-color', colors.error);
            await page.screenshot({path: testInfo.outputPath('shared-controls.png')});
            // Changing one standard token affects both form-level and strategy groups.
            await page.evaluate(() => document.documentElement.style.setProperty('--collapse-summary-padding', '17px'));
            for (const header of [common.locator(':scope > summary'), training.locator(':scope > summary')]) {
                await expect(header).toHaveCSS('padding-top', '17px');
            }
            await page.goto('/settings/style-tokens');
            await expect(page.locator('#collapse .ui-collapse > summary')).toHaveText('LSTM parameters');
            await expect(page.locator('#collapse')).toContainText('--collapse-summary-padding');
        });
    }
}
