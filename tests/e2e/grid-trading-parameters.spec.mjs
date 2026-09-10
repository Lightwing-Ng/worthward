/* Grid Trading parameter contracts. Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

test('derives trade quantity and preserves optional holding presentation', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=QQQ&range=2y&strategy=grid-trading'
        + '&show_trade_details=1&initial_holding=100&fall=2.00');

    await expect(page.locator('#tradePriceChart')).toBeVisible();
    const quantity = page.locator('#strategy_param_quantity');
    const minimum = page.locator('#strategy_param_holding_min');
    const maximum = page.locator('#strategy_param_holding_max');

    const expectedQuantity = await page.evaluate(() => {
        const result = window.WORTHWARD_APP.backtestResult;
        return String(Math.floor(result.summary.initial_cash / (result.chart.open[0] * 10)));
    });
    await expect(quantity).toHaveValue(expectedQuantity);
    await expect(minimum).toHaveValue('');
    await expect(minimum).toHaveAttribute('placeholder', '0');
    await expect(maximum).toHaveValue('');
    await expect(maximum).not.toHaveAttribute('placeholder', /.+/);

    const keys = await page.locator('[data-trade-strategy-params-grid] > [data-strategy-param-key]')
        .evaluateAll((fields) => fields.map((field) => field.dataset.strategyParamKey));
    expect(keys).toEqual([
        'initial_holding',
        'quantity',
        'holding_min',
        'holding_max',
        'rise',
        'fall',
    ]);

    await maximum.fill('12345');
    await maximum.blur();
    await expect(maximum).toHaveValue('12,345');
    await expect.poll(() => new URL(page.url()).searchParams.get('holding_max')).toBe('12345');
    await expect(maximum).toHaveValue('12,345');
});

test('submits an explicit per-grid-trade quantity to the execution engine', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=QQQ&range=2y&strategy=grid-trading'
        + '&show_trade_details=1&initial_holding=100&quantity=3&fall=2.00');

    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await expect(page.locator('#strategy_param_quantity')).toHaveValue('3');
    const execution = await page.evaluate(() => ({
        resolvedQuantity: window.WORTHWARD_APP.backtestResult.summary.grid_trade_quantity,
        tradeQuantities: window.WORTHWARD_APP.backtestResult.trades.map((trade) => trade.shares),
    }));
    expect(execution.resolvedQuantity).toBe(3);
    expect(execution.tradeQuantities.every((shares) => shares <= 3)).toBe(true);
});
