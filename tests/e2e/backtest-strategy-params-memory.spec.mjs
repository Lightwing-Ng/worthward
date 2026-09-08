/* Code version: v0.3.0 */
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

test('Leveraged Rotation exposes dynamic ticker labels and a collision-safe allocation band', async ({page}) => {
    await page.setViewportSize({width: 1023, height: 1404});
    await page.goto('/workspaces/backtest?range=2y&strategy=leveraged-rotation&capital=10000&stop_loss=1'
        + '&initial_primary_pct=44.2&initial_leveraged_pct=36.3');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await page.getByText('Initial allocation', {exact: true}).click();

    const allocation = page.locator('[data-strategy-allocation-range]');
    await expect(allocation).toBeVisible();
    await expect(page.getByText('Allocation limits (% of total equity)', {exact: true})).toBeVisible();
    await expect(page.getByText('Rotation triggers (daily % change)', {exact: true})).toBeVisible();
    await expect(page.getByText('QQQ minimum', {exact: true})).toBeAttached();
    await expect(page.getByText('QQQ maximum', {exact: true})).toBeAttached();
    await expect(page.getByText('TQQQ minimum', {exact: true})).toBeAttached();
    await expect(page.getByText('TQQQ maximum', {exact: true})).toBeAttached();
    await expect(page.getByText('QQQ daily drop trigger', {exact: true})).toBeAttached();
    await expect(page.getByText('TQQQ daily rise trigger', {exact: true})).toBeAttached();
    await expect(page.locator('#strategy_param_primary_min_pct')).toHaveValue('20.00');
    await expect(page.locator('#strategy_param_primary_max_pct')).toHaveValue('95.00');
    await expect(page.locator('#strategy_param_buy_leveraged_drop_pct')).toHaveValue('3.00');
    await expect(page.locator('#strategy_param_sell_leveraged_rise_pct')).toHaveValue('5.00');
    await expect(allocation.locator('[data-allocation-primary-name]')).toHaveText('QQQ');
    await expect(allocation.locator('[data-allocation-leveraged-name]')).toHaveText('TQQQ');
    await expect(allocation.locator('[data-allocation-primary-value]')).toHaveText('44.20%');
    await expect(allocation.locator('[data-allocation-leveraged-value]')).toHaveText('36.30%');
    await expect(allocation.locator('[data-allocation-cash-value]')).toHaveText(/^[\d,]+\.\d{2}$/);
    await expect(allocation).not.toContainText(/\d[\d,]* sh\b/);
    await expect(allocation.locator('[data-allocation-cash-label]')).not.toContainText('%');

    const segmentColors = await allocation.evaluate((element) => {
        const tokenColor = (name) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${name})`;
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        const background = (selector) => getComputedStyle(element.querySelector(selector)).backgroundColor;
        return {
            actual: [
                background('[data-allocation-primary-segment]'),
                background('[data-allocation-leveraged-segment]'),
                background('[data-allocation-cash-segment]'),
            ],
            expected: [
                tokenColor('--theme-accent-primary'),
                tokenColor('--theme-accent-secondary'),
                tokenColor('--theme-accent-positive'),
            ],
        };
    });
    expect(segmentColors.actual).toEqual(segmentColors.expected);

    await allocation.locator('[data-allocation-boundary="primary"]').evaluate((input) => {
        input.value = '55.25';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(allocation.locator('[name="initial_primary_pct"]')).toHaveValue('55.25');
    await expect(allocation.locator('[name="initial_leveraged_pct"]')).toHaveValue('36.30');
    await allocation.locator('[data-allocation-boundary="invested"]').evaluate((input) => {
        input.value = '88.88';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(allocation.locator('[name="initial_primary_pct"]')).toHaveValue('55.25');
    await expect(allocation.locator('[name="initial_leveraged_pct"]')).toHaveValue('33.63');
    await expect(allocation.locator('[data-allocation-primary-value]')).toHaveText('55.25%');
    await expect(allocation.locator('[data-allocation-leveraged-value]')).toHaveText('33.63%');
    const integerPreview = await allocation.evaluate((element) => ({
        primaryShares: element.dataset.allocationPrimaryShares,
        leveragedShares: element.dataset.allocationLeveragedShares,
        cash: element.dataset.allocationCash,
    }));
    expect(integerPreview.primaryShares).toMatch(/^\d+$/);
    expect(integerPreview.leveragedShares).toMatch(/^\d+$/);
    expect(integerPreview.cash).toMatch(/^\d+\.\d{2}$/);

    await page.locator('[data-backtest-ticker-fields] [data-ticker-input]').evaluateAll((inputs) => {
        inputs[0].value = 'SPY';
        inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
        inputs[1].value = 'UPRO';
        inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(page.getByText('SPY minimum', {exact: true})).toBeAttached();
    await expect(page.getByText('UPRO maximum', {exact: true})).toBeAttached();
    await expect(page.getByText('SPY daily drop trigger', {exact: true})).toBeAttached();
    await expect(page.getByText('UPRO daily rise trigger', {exact: true})).toBeAttached();
    await expect(allocation.locator('[data-allocation-primary-name]')).toHaveText('SPY');
    await expect(allocation.locator('[data-allocation-leveraged-name]')).toHaveText('UPRO');

    await page.setViewportSize({width: 390, height: 844});
    await expect(allocation).toBeVisible();
    await expect.poll(() => allocation.locator('[data-allocation-cash-label]')
        .getAttribute('data-allocation-label-position')).not.toBeNull();
    const [allocationBox, panelBox, labelBoxes] = await Promise.all([
        allocation.boundingBox(), page.locator('[data-trade-strategy-panel]').boundingBox(),
        allocation.locator('.strategy-allocation-label').evaluateAll((labels) => labels.map((label) => {
            const box = label.getBoundingClientRect();
            return {left: box.left, right: box.right};
        })),
    ]);
    expect(allocationBox.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(allocationBox.x + allocationBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    expect(labelBoxes[0].right + 5).toBeLessThanOrEqual(labelBoxes[1].left);
    expect(labelBoxes[1].right + 5).toBeLessThanOrEqual(labelBoxes[2].left);
});
