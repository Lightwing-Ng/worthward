/* Code version: v1.1.1 */
import {expect, test} from '@playwright/test';

for (const colorScheme of ['light', 'dark']) {
    for (const width of [1138, 390]) {
        test(`trailing disclosure icons preserve text alignment at ${width}px in ${colorScheme}`, async ({page}) => {
            await page.setViewportSize({width, height: 959});
            await page.emulateMedia({colorScheme});
            await page.goto('/workspaces/backtest?ticker=QQQ&range=3y&strategy=lstm-price-field&show_trade_details=0&cell_display_threshold=2.00&use_option_total_open_interest=1&use_option_total_volume=1');
            const summary = page.locator('[data-collapse="backtest"] > summary');
            const read = () => summary.evaluate(el => {
                const text = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
                const range = document.createRange();
                range.selectNodeContents(text);
                const after = getComputedStyle(el, '::after');
                return {
                    color: after.backgroundColor,
                    textColor: getComputedStyle(el).color,
                    textLeft: range.getBoundingClientRect().left,
                    labelLeft: document.querySelector('label[for="trade_strategy"]').getBoundingClientRect().left,
                    before: getComputedStyle(el, '::before').content,
                    mask: after.maskImage || after.webkitMaskImage,
                    transform: after.transform,
                    column: after.gridColumnStart,
                    width: after.width,
                    height: after.height,
                    overflow: document.documentElement.scrollWidth - innerWidth,
                };
            });
            let state = await read();
            expect(Math.abs(state.textLeft - state.labelLeft)).toBeLessThan(1);
            expect(state.before).toBe('none');
            expect(state.color).toBe(state.textColor);
            expect(state.column).toBe('2');
            expect(state.width).toBe('12px');
            expect(state.height).toBe('8px');
            expect(state.mask).toContain('M1.41');
            expect(state.transform).toBe('matrix(-1, 0, 0, -1, 0, 0)');
            expect(state.overflow).toBeLessThanOrEqual(1);
            await summary.focus();
            await summary.press('Enter');
            await expect(page.locator('[data-collapse="backtest"]')).not.toHaveAttribute('open');
            await page.waitForTimeout(650);
            state = await read();
            expect(state.color).toBe(state.textColor);
            expect(state.mask).toContain('M1.41');
            expect(state.transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
            expect(Math.abs(state.textLeft - state.labelLeft)).toBeLessThan(1);
            await summary.press('Space');
            await expect(page.locator('[data-collapse="backtest"]')).toHaveAttribute('open');
            await page.waitForTimeout(650);
            await page.goto('/settings/style-tokens');
            const specimen = page.locator('#collapse details > summary');
            const collapseExample = page.locator('[data-style-token-collapse-example]');
            await expect(specimen).toHaveCSS('display', 'grid');
            await expect(specimen).toHaveCSS('padding-left', '0px');
            await expect(collapseExample).toBeHidden();
            await specimen.click();
            await expect(collapseExample).toBeVisible();
            await expect(collapseExample.locator('.style-token-collapse-example-row')).toHaveCount(5);
            await expect(collapseExample).toContainText('LSTM lookback');
            await expect(collapseExample).toContainText('0.050');
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
            await specimen.click();
            await expect(collapseExample).toBeHidden();
            await page.goto('/settings/strategies');
            await expect(page.locator('.settings-strategy-summary').first()).toHaveCSS('display', 'grid');
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        });
    }
}
