/* Code version: v0.1.0 */
import {expect, test} from '@playwright/test';

const MEMORY_KEY = 'antigravity:backtest-strategy-params:v1';

const readRememberedValue = async (page, strategyId, key) => page.evaluate(
    ({key: storageKey, strategyId: storedStrategyId, paramKey}) => {
        const memory = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
        return memory?.[storedStrategyId]?.[paramKey] || null;
    },
    {key: MEMORY_KEY, strategyId, paramKey: key},
);

test('remembers Backtest parameters per strategy and gives explicit URLs precedence', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');
    await expect(page.locator('#tradeEquityChart')).toBeVisible();
    await page.evaluate((key) => window.localStorage.removeItem(key), MEMORY_KEY);

    const gridFloor = page.locator('#strategy_param_price_floor');
    await gridFloor.fill('123.45');
    await gridFloor.blur();
    await expect.poll(() => readRememberedValue(page, 'grid-trading', 'price_floor')).toBe('123.45');

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=dca&stop_loss=0');
    await expect(page.locator('#tradeEquityChart')).toBeVisible();
    const dcaAmount = page.locator('#strategy_param_amount');
    await dcaAmount.fill('2340');
    await dcaAmount.blur();
    await expect.poll(() => readRememberedValue(page, 'dca', 'amount')).toBe('2340.0');

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');
    await expect(page.locator('#strategy_param_price_floor')).toHaveValue('123.45');
    await expect(page.locator('#strategy_param_amount')).toHaveCount(0);

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0&price_floor=7.89');
    await expect(page.locator('#strategy_param_price_floor')).toHaveValue('7.89');
    await expect.poll(() => readRememberedValue(page, 'grid-trading', 'price_floor')).toBe('123.45');
});
