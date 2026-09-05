/* Code version: v0.1.0 */
import {expect, test} from '@playwright/test';

test('Backtest defaults are off and explicit opt-ins survive reload', async ({page}) => {
    await page.goto('/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold');
    await expect(page.locator('#stop_loss')).not.toBeChecked();
    await expect(page.locator('#show_trade_details')).not.toBeChecked();
    await expect(page.locator('#tradeEquityChart')).not.toBeVisible();
    await expect(page.locator('#backtest_history_transactions')).toBeDisabled();
    await page.locator('label[for="show_trade_details"]').click();
    await expect(page.locator('#show_trade_details')).toBeChecked();
    await expect(page).toHaveURL(/show_trade_details=1/);
    await page.reload();
    await expect(page.locator('#show_trade_details')).toBeChecked();
    await expect(page.locator('#tradeEquityChart')).toBeVisible();
    await page.goto('/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&stop_loss=1&show_trade_details=1');
    await expect(page.locator('#stop_loss')).toBeChecked();
    await expect(page.locator('#show_trade_details')).toBeChecked();
});

test('strategy fragments reuse real market-factor sections without external-factor impostors', async ({request}) => {
    const strategies = ['macd', 'macd-gemini', 'knn-machine-learning', 'knn-machine-learning-gemini',
        'lorentzian-classification', 'lorentzian-classification-gemini', 'lorentzian-classification-chatgpt',
        'supertrend-ai', 'supertrend_ai_gemini', 'bayesian-price-field', 'lstm-price-field'];
    for (const strategy of strategies) {
        const response = await request.get(`/api/trade-strategy-fields?strategy=${strategy}`);
        expect(response.ok()).toBe(true);
        const {html} = await response.json();
        expect(html).toContain('Market factors');
        expect(html).toContain('strategy-parameter-collapse');
        expect(html).not.toContain('Training factors');
        if (!strategy.endsWith('price-field')) expect(html).not.toContain('name="use_pe_ratio"');
    }
    for (const strategy of ['buy-and-hold', 'grid-trading', 'dca', 'leveraged-rotation']) {
        const {html} = await (await request.get(`/api/trade-strategy-fields?strategy=${strategy}`)).json();
        expect(html).not.toContain('Market factors');
    }
});

test('strategy switching keeps factor inputs scoped and submits their edited values', async ({page}) => {
    await page.goto('/workspaces/backtest?ticker=QQQ&strategy=macd');
    await expect(page.locator('#strategy_param_fast_span')).toBeVisible();
    await page.locator('#trade_strategy').evaluate(select => {
        select.value = 'knn-machine-learning';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('#strategy_param_short_window')).toBeAttached();
    await expect(page.locator('#strategy_param_fast_span')).toHaveCount(0);
    const factors = page.locator('#trade_strategy_params_panel details').filter({has: page.locator('summary', {hasText: 'Market factors'})});
    await factors.locator('summary').click();
    const period = page.locator('#strategy_param_short_window');
    await expect(period).toBeVisible();
    await period.fill('17');
    await period.press('Tab');
    await expect(page).toHaveURL(/short_window=17/);
    await page.reload();
    await expect(page.locator('#strategy_param_short_window')).toHaveValue('17');
    await expect(page.locator('#strategy_param_use_pe_ratio')).toHaveCount(0);
});
