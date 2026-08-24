/* Code version: v0.2.0 */
import {expect, test} from '@playwright/test';

const assertNoVisibleNativeSelects = async (page) => {
    await expect(page.locator('select:visible')).toHaveCount(0);
};

const assertOptionMarkup = async (page, dropdownSelector) => {
    const optionChildren = await page.locator(`${dropdownSelector} [role="option"]`).evaluateAll((options) => (
        options.map((option) => Array.from(option.children).map((child) => child.className))
    ));
    expect(optionChildren.length).toBeGreaterThan(0);
    expect(optionChildren.every((children) => (
        children.length === 2
        && children[0] === 'trade-strategy-dropdown-check'
        && children[1] === 'trade-strategy-dropdown-text'
    ))).toBe(true);
};

test('reuses the shared dropdown contract across workspace selectors', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1y');
    await assertNoVisibleNativeSelects(page);

    const periodField = page.locator('#period_panel [data-shared-select-field]');
    await expect(periodField).toHaveCount(1);
    await expect(periodField.locator('[data-shared-select-trigger]')).toHaveCount(1);
    await expect(periodField.locator('[data-shared-select-dropdown]')).toHaveCount(1);
    await periodField.locator('[data-shared-select-trigger]').click();
    await expect(periodField.locator('[data-shared-select-dropdown]')).toBeVisible();
    await assertOptionMarkup(page, '#period_dropdown');

    await page.goto('/workspaces/backtest?ticker=AAPL&strategy=grid-trading');
    await assertNoVisibleNativeSelects(page);
    const strategyField = page.locator('[data-shared-select-field][data-shared-select-kind="strategy"]');
    await expect(strategyField).toHaveCount(1);
    await expect(strategyField).toHaveClass(/backtest-shared-select-field/);
    await expect(strategyField.locator('[data-shared-select-trigger]:visible')).toHaveCount(1);
    await expect(strategyField.locator('[data-shared-select-dropdown]')).toHaveCount(1);
    await expect(page.locator('#period_panel [data-shared-select-trigger]:visible')).toHaveCount(1);
    await strategyField.locator('[data-shared-select-trigger]').click();
    await expect(page.locator('#trade_strategy_dropdown')).toBeVisible();
    const strategyGeometry = await page.evaluate(() => {
        const trigger = document.querySelector('[data-shared-select-kind="strategy"] [data-shared-select-trigger]');
        const dropdown = document.querySelector('#trade_strategy_dropdown');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return null;
        return {
            triggerWidth: trigger.getBoundingClientRect().width,
            dropdownWidth: dropdown.getBoundingClientRect().width,
            dropdownCssWidth: getComputedStyle(dropdown).width,
            dropdownInlineWidth: dropdown.style.width,
            position: getComputedStyle(dropdown).position,
            isOverlayChild: dropdown.parentElement?.matches('[data-shared-select-overlay]') || false,
        };
    });
    expect(strategyGeometry).not.toBeNull();
    expect(strategyGeometry?.dropdownCssWidth).toBe(`${Math.round(strategyGeometry?.triggerWidth || 0)}px`);
    expect(strategyGeometry?.dropdownInlineWidth).toBe(`${Math.round(strategyGeometry?.triggerWidth || 0)}px`);
    expect(strategyGeometry?.position).toBe('fixed');
    expect(strategyGeometry?.isOverlayChild).toBe(true);
    await assertOptionMarkup(page, '#trade_strategy_dropdown');
});
