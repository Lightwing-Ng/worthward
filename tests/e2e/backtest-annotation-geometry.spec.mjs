/* Backtest annotation regression. Code version: v1.3.0 */
import {expect, test} from '@playwright/test';
import {openBacktestParameterOverlay} from './backtest-parameter-overlay-helper.mjs';

for (const width of [1023, 390]) {
    test(`Backtest annotated controls at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 1404});
        await page.route('**/api/lstm-training', route => route.fulfill({json: {
            success: true, protocol_version: 2, runs: [],
        }}));
        await page.goto('/workspaces/backtest?strategy=lstm-price-field&show_trade_details=1&compute_backend=CPU&lstm_epochs=1&lstm_lookback=4&lstm_hidden_size=4&training_window=40');
        const segments = page.locator('#backtest_history_view_segmented');
        for (const value of ['transactions', 'metrics', 'probability', 'transactions']) {
            await segments.locator(`label[for="backtest_history_${value}"]`).click();
            const weights = await segments.locator('label').evaluateAll(labels => labels.map(label => ({
                checked: label.querySelector('input').checked,
                weight: getComputedStyle(label.querySelector('span')).fontWeight,
            })));
            expect(weights.filter(item => item.checked)).toHaveLength(1);
            for (const item of weights) expect(item.weight).toBe(item.checked ? '700' : '400');
        }
        await openBacktestParameterOverlay(page);
        const parameters = page.locator('[data-collapse="parameters"]');
        if (!await parameters.evaluate(node => node.open)) await parameters.locator(':scope > summary').click();
        const row = parameters.locator('[data-strategy-param-key="chip_window"]');
        const geometry = await row.evaluate(node => {
            const separatorCenter = element => {
                const style = getComputedStyle(element, '::before');
                return element.getBoundingClientRect().top
                    + parseFloat(getComputedStyle(element).borderTopWidth)
                    + parseFloat(style.top) + parseFloat(style.height) / 2;
            };
            const center = element => {
                const bounds = element.getBoundingClientRect();
                return bounds.top + bounds.height / 2;
            };
            return {
                midpoint: (separatorCenter(node) + separatorCenter(node.nextElementSibling)) / 2,
                label: center(node.querySelector('label')),
                input: center(node.querySelector('input')),
            };
        });
        expect(Math.abs(geometry.label - geometry.midpoint)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.input - geometry.midpoint)).toBeLessThanOrEqual(1);
        const training = page.locator('[data-collapse="training"]');
        if (!await training.evaluate(node => node.open)) await training.locator(':scope > summary').click();
        const title = training.locator('.lstm-training-history-title');
        const empty = training.locator('.lstm-training-history-empty');
        await expect(title).toHaveCSS('font-size', '15px');
        await expect(title).toHaveCSS('font-weight', '400');
        await expect(empty).toBeVisible();
        expect(Math.abs((await empty.boundingBox()).x - (await title.boundingBox()).x)).toBeLessThan(1);
        const totalTrades = page.locator('#backtest_metrics_panel .trade-metric-card').filter({hasText: 'Total trades'});
        const totalTradesLabel = totalTrades.locator('.trade-metric-label');
        await expect(totalTradesLabel).toHaveText('Total trades');
        await expect(totalTradesLabel).toHaveCSS('font-size', '15px');
        await expect(totalTradesLabel).toHaveCSS('font-weight', '400');
        await expect(totalTradesLabel).toHaveCSS('line-height', 'normal');
        await expect(totalTradesLabel).toHaveCSS('color', 'rgb(11, 12, 12)');
        const metricGeometry = await page.locator('#backtest_metrics_panel .trade-metric-card').evaluateAll(cards => cards.map(card => {
            const label = card.querySelector('.trade-metric-label').getBoundingClientRect();
            const value = card.querySelector('.trade-metric-value').getBoundingClientRect();
            const bounds = card.getBoundingClientRect();
            return {labelBottom: label.bottom, valueTop: value.top, valueBottom: value.bottom, cardBottom: bounds.bottom};
        }));
        for (const metric of metricGeometry) {
            expect(metric.labelBottom).toBeLessThanOrEqual(metric.valueTop + 0.5);
            expect(metric.valueBottom).toBeLessThanOrEqual(metric.cardBottom + 1);
        }
        await training.locator('[data-strategy-param-key="compute_backend"] .trade-strategy-trigger').click();
        const menu = page.locator('#strategy_param_compute_backend_dropdown');
        await expect(menu).toBeVisible();
        for (const index of [0, 1, 2]) {
            await expect(page.locator(`#strategy_param_compute_backend_dropdown_option_${index}`)).toHaveCSS('height', '32px');
        }
        const wrapped = page.locator('#strategy_param_compute_backend_dropdown_option_3');
        expect(await wrapped.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
        await menu.locator('[role="option"]').first().press('Escape');
    });
}
