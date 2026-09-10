/* Shared Backtest control primitives. Code version: v1.3.0 */
import {test, expect} from '@playwright/test';
import {openBacktestParameterOverlay} from './backtest-parameter-overlay-helper.mjs';

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
            await page.goto('/workspaces/backtest?strategy=lstm-price-field&show_trade_details=0&compute_backend=CPU&lstm_epochs=1&lstm_lookback=4&lstm_hidden_size=4&training_window=40');
            await openBacktestParameterOverlay(page);
            const common = page.locator('[data-collapse="backtest"]');
            const training = page.locator('[data-collapse="training"]');
            const summary = common.locator(':scope > summary');
            await expect(summary).toHaveCSS('padding-left', '0px');
            await expect(summary).toHaveCSS('padding-right', '0px');
            const strategyLabel = page.locator('label[for="trade_strategy"]');
            expect(Math.abs((await summary.boundingBox()).x - (await strategyLabel.boundingBox()).x)).toBeLessThan(1);
            await expect(common.locator('#trade_initial_capital')).toBeVisible();
            await common.locator(':scope > summary').click();
            await expect(common.locator('#trade_initial_capital')).toBeHidden();
            await expect(common.locator('#show_trade_details')).toBeHidden();
            expect(Math.abs((await summary.boundingBox()).x - (await strategyLabel.boundingBox()).x)).toBeLessThan(1);
            await expect(training.locator('details')).toHaveCount(0);
            await expect(training.locator(':scope > .ui-collapse-body')).toHaveCSS('padding-right', '4px');
            await expect(training.locator(':scope > .ui-collapse-body')).toHaveCSS('padding-bottom', '0px');
            await expect(training.locator(':scope > .ui-collapse-body')).toHaveCSS('padding-left', '4px');
            await expect(training.locator('[data-strategy-param-key]').first()).toHaveAttribute('data-strategy-param-key', 'compute_backend');
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
            await expect(entry).toHaveCSS('padding', '0px');
            await expect(entry).toHaveCSS('height', '36px');
            const historyGeometry = await entry.evaluate(node => {
                const heading = node.closest('.lstm-training-history-collapse').querySelector('.lstm-training-history-heading').getBoundingClientRect();
                const row = node.getBoundingClientRect();
                const pill = node.querySelector('.lstm-training-history-select').getBoundingClientRect();
                return {entryLeft: row.left - heading.left, pillLeft: pill.left - heading.left,
                    rightInset: row.right - pill.right};
            });
            expect(Math.abs(historyGeometry.entryLeft)).toBeLessThan(1);
            expect(historyGeometry.pillLeft).toBe(0);
            expect(historyGeometry.rightInset).toBe(0);
            expect(await entry.locator('.lstm-training-history-identifier').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            expect(await entry.locator('.lstm-training-history-run').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
            const sections = page.locator('#trade_strategy_params_panel > details');
            for (const section of await sections.all()) {
                if (!(await section.evaluate(el => el.open))) await section.locator(':scope > summary').click();
            }
            await expect(page.locator('#trade_strategy_params_panel > details[open]')).toHaveCount(3);
            await training.locator(':scope > summary').press('Enter');
            await expect(page.locator('#trade_strategy_params_panel > details[open]')).toHaveCount(2);
            await training.locator(':scope > summary').press('Enter');
            await expect(page.locator('#trade_strategy_params_panel > details[open]')).toHaveCount(3);
            const factorGroups = page.locator('[data-collapse="factors"] .strategy-factor-group');
            await expect(factorGroups).toHaveCount(5);
            for (const group of await factorGroups.all()) {
                await group.locator(':scope > summary').click();
            }
            await expect(page.locator('.strategy-factor-group[open]')).toHaveCount(5);
            await expect(page.locator('[data-collapse="factors"] [data-strategy-param-key]')).toHaveCount(36);
            await expect(page.locator('#strategy_param_use_turnover_switch')).not.toBeChecked();
            const factorOverflow = await page.locator('[data-collapse="factors"]').evaluate(el => {
                const bounds = el.getBoundingClientRect();
                return [...el.querySelectorAll('[data-strategy-param-key], .switch, .trade-strategy-param-label-trigger > span:first-child')]
                    .filter(node => {
                        const rect = node.getBoundingClientRect();
                        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
                    }).map(node => ({text: node.textContent.slice(0, 40), width: node.getBoundingClientRect().width}));
            });
            expect(factorOverflow).toEqual([]);
            await page.screenshot({path: testInfo.outputPath('factor-groups.png'), fullPage: true});
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
            await expect(page.locator('#collapse .ui-collapse > summary')).toHaveCSS('padding-left', '0px');
            const modalMaterial = await page.locator('.workspace-modal-dialog.style-token-modal-demo').evaluate(node => {
                const probe = document.createElement('div');
                probe.style.cssText = 'background:var(--frosted-glass-background);backdrop-filter:var(--frosted-glass-blur)';
                node.append(probe);
                const result = {
                    background: getComputedStyle(node).background,
                    expected: getComputedStyle(probe).background,
                    blur: getComputedStyle(node).backdropFilter,
                    expectedBlur: getComputedStyle(probe).backdropFilter,
                    extraLayer: getComputedStyle(node, '::after').content,
                };
                probe.remove();
                return result;
            });
            expect(modalMaterial.background).toBe(modalMaterial.expected);
            expect(modalMaterial.blur).toBe(modalMaterial.expectedBlur);
            expect(modalMaterial.extraLayer).toBe('none');
        });
    }
}
