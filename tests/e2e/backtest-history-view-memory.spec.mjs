/* Backtest history-view memory. Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

const MEMORY_KEY = 'worthward:backtest-history-view:v1';

const chooseStrategy = async (page, strategyId) => {
    await page.locator('[data-trade-strategy-trigger]').click();
    const option = page.locator(`[data-trade-strategy-dropdown] [data-value="${strategyId}"]`);
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(page).toHaveURL(new RegExp(`strategy=${strategyId}`), {timeout: 30_000});
    await expect(page.locator('#trade_strategy')).toHaveValue(strategyId);
};

test('remembers the Backtest history view across reloads and strategy changes', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto('/workspaces/backtest?range=1y&strategy=supertrend-ai&show_trade_details=1');
    await page.evaluate((key) => window.localStorage.removeItem(key), MEMORY_KEY);
    await page.reload();

    await expect(page.locator('#backtest_history_transactions')).toBeChecked();
    await page.locator('label[for="backtest_history_metrics"]').click();
    await expect(page.locator('#backtest_history_metrics')).toBeChecked();
    await expect.poll(() => page.evaluate(
        (key) => window.localStorage.getItem(key),
        MEMORY_KEY,
    )).toBe('metrics');

    await page.reload();
    await expect(page.locator('#backtest_history_metrics')).toBeChecked();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_transactions_panel')).toBeHidden();

    await chooseStrategy(page, 'leveraged-rotation');
    await expect(page.locator('#backtest_history_metrics')).toBeChecked();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeVisible();

    await page.locator('label[for="backtest_history_transactions"]').click();
    await expect.poll(() => page.evaluate(
        (key) => window.localStorage.getItem(key),
        MEMORY_KEY,
    )).toBe('transactions');

    await chooseStrategy(page, 'supertrend-ai');
    await expect(page.locator('#backtest_history_transactions')).toBeChecked();
    await expect(page.locator('#backtest_history_transactions_panel')).toBeVisible();
    await expect(page.locator('#backtest_history_metrics_panel')).toBeHidden();
});
