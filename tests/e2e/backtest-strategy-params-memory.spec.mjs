/* Code version: v0.2.0 */
import {expect, test} from '@playwright/test';

const MEMORY_KEY = 'worthward:backtest-strategy-params:v1';

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
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await page.evaluate((key) => window.localStorage.removeItem(key), MEMORY_KEY);

    const gridMaximum = page.locator('#strategy_param_holding_max');
    await gridMaximum.fill('500');
    await gridMaximum.blur();
    await expect.poll(() => readRememberedValue(page, 'grid-trading', 'holding_max')).toBe('500');

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=dca&stop_loss=0');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    const dcaAmount = page.locator('#strategy_param_amount');
    await dcaAmount.fill('2340');
    await dcaAmount.blur();
    await expect.poll(() => readRememberedValue(page, 'dca', 'amount')).toBe('2340.0');

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');
    await expect(page.locator('#strategy_param_holding_max')).toHaveValue('500');
    await expect(page.locator('#strategy_param_amount')).toHaveCount(0);

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0&holding_max=789');
    await expect(page.locator('#strategy_param_holding_max')).toHaveValue('789');
    await expect.poll(() => readRememberedValue(page, 'grid-trading', 'holding_max')).toBe('500');
});

test('Leveraged Rotation exposes a two-handle integer allocation preview', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?range=2y&strategy=leveraged-rotation&capital=10000&stop_loss=1');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await page.getByText('Initial allocation', {exact: true}).click();

    const allocation = page.locator('[data-strategy-allocation-range]');
    await expect(allocation).toBeVisible();
    await expect(allocation.locator('[data-allocation-primary-label]')).toHaveText(/QQQ [\d,]+ sh · 70\.0%/);
    await expect(allocation.locator('[data-allocation-leveraged-label]')).toContainText('TQQQ');
    await expect(allocation.locator('[data-allocation-cash-label]')).toHaveText(/Cash [\d,]+\.\d{2} · 5\.0%/);

    await allocation.locator('[data-allocation-boundary="primary"]').evaluate((input) => {
        input.value = '60';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await allocation.locator('[data-allocation-boundary="invested"]').evaluate((input) => {
        input.value = '90';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(allocation.locator('[name="initial_primary_pct"]')).toHaveValue('60.0');
    await expect(allocation.locator('[name="initial_leveraged_pct"]')).toHaveValue('30.0');
    await expect(allocation.locator('[data-allocation-cash-label]')).toHaveText(/Cash [\d,]+\.\d{2} · 10\.0%/);

    await page.setViewportSize({width: 390, height: 844});
    await expect(allocation).toBeVisible();
    const [allocationBox, panelBox] = await Promise.all([
        allocation.boundingBox(),
        page.locator('[data-trade-strategy-panel]').boundingBox(),
    ]);
    expect(allocationBox.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(allocationBox.x + allocationBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
});
