/* Backtest content-sized strategy-choice parity. Code version: v1.1.1 */
import {expect, test} from '@playwright/test';

const readChoiceMenuContract = async (page, key) => {
    const field = page.locator(`[data-strategy-param-key="${key}"]`);
    const trigger = field.locator('[data-shared-select-trigger]');
    await expect(field).toHaveAttribute('data-strategy-param-content-sized', 'true');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = page.locator(`#strategy_param_${key}_dropdown`);
    await expect(dropdown).toBeVisible();
    await trigger.evaluate(async (element) => {
        await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    });
    const contract = await page.evaluate((parameterKey) => {
        const parameterField = document.querySelector(`[data-strategy-param-key="${parameterKey}"]`);
        const parameterTrigger = parameterField?.querySelector('[data-shared-select-trigger]');
        const triggerLabel = parameterTrigger?.querySelector('[data-shared-select-trigger-label]');
        const parameterDropdown = document.querySelector(`#strategy_param_${parameterKey}_dropdown`);
        const firstOption = parameterDropdown?.querySelector('[role="option"]');
        if (
            !(parameterField instanceof HTMLElement)
            || !(parameterTrigger instanceof HTMLElement)
            || !(triggerLabel instanceof HTMLElement)
            || !(parameterDropdown instanceof HTMLElement)
            || !(firstOption instanceof HTMLElement)
        ) {
            return null;
        }
        const triggerStyle = getComputedStyle(parameterTrigger);
        const labelStyle = getComputedStyle(triggerLabel);
        const dropdownStyle = getComputedStyle(parameterDropdown);
        const optionStyle = getComputedStyle(firstOption);
        const triggerBox = parameterTrigger.getBoundingClientRect();
        const labelBox = triggerLabel.getBoundingClientRect();
        return {
            trigger: {
                height: triggerStyle.height,
                paddingLeft: triggerStyle.paddingLeft,
                paddingRight: triggerStyle.paddingRight,
                borderRadius: triggerStyle.borderRadius,
                backgroundColor: triggerStyle.backgroundColor,
                fontSize: triggerStyle.fontSize,
            },
            label: {
                minWidth: labelStyle.minWidth,
                overflow: labelStyle.overflow,
                textOverflow: labelStyle.textOverflow,
                whiteSpace: labelStyle.whiteSpace,
            },
            geometry: {
                rightDelta: Math.abs(parameterField.getBoundingClientRect().right - triggerBox.right),
                labelOverflow: triggerLabel.scrollWidth - triggerLabel.clientWidth,
                labelWidth: labelBox.width,
            },
            menu: {
                isPageLevelOverlayChild: parameterDropdown.parentElement?.hasAttribute('data-shared-select-overlay') || false,
                position: dropdownStyle.position,
                padding: dropdownStyle.padding,
                borderRadius: dropdownStyle.borderRadius,
                backgroundColor: dropdownStyle.backgroundColor,
                backgroundImage: dropdownStyle.backgroundImage,
            },
            option: {
                minHeight: optionStyle.minHeight,
                padding: optionStyle.padding,
                checkColumnWidth: optionStyle.gridTemplateColumns.split(/\s+/)[0],
                columnGap: optionStyle.columnGap,
                alignItems: optionStyle.alignItems,
                fontSize: optionStyle.fontSize,
            },
            optionChildren: Array.from(parameterDropdown.querySelectorAll('[role="option"]'))
                .map((option) => Array.from(option.children).map((child) => child.className)),
        };
    }, key);
    await page.keyboard.press('Escape');
    return contract;
};

test('DCA Frequency reuses the Leveraged Rotation Return window menu contract', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto('/workspaces/backtest?range=1y&strategy=leveraged-rotation&show_trade_details=0');
    await page.getByText('Rotation triggers (%, change)', {exact: true}).click();
    const returnWindow = await readChoiceMenuContract(page, 'rotation_window');
    expect(returnWindow).not.toBeNull();

    await page.goto('/workspaces/backtest?range=1y&strategy=dca&show_trade_details=0&amount=100');
    const frequency = await readChoiceMenuContract(page, 'frequency');
    expect(frequency).not.toBeNull();

    expect(frequency?.trigger).toEqual(returnWindow?.trigger);
    expect(frequency?.label).toEqual(returnWindow?.label);
    expect(returnWindow?.geometry.rightDelta).toBeLessThanOrEqual(1);
    expect(frequency?.geometry.rightDelta).toBeLessThanOrEqual(1);
    expect(returnWindow?.geometry.labelOverflow).toBeLessThanOrEqual(1);
    expect(frequency?.geometry.labelOverflow).toBeLessThanOrEqual(1);
    expect(returnWindow?.geometry.labelWidth).toBeGreaterThan(0);
    expect(frequency?.geometry.labelWidth).toBeGreaterThan(0);
    expect(frequency?.menu).toEqual(returnWindow?.menu);
    expect(frequency?.option).toEqual(returnWindow?.option);
    expect(frequency?.optionChildren).toEqual([
        ['trade-strategy-dropdown-check', 'trade-strategy-dropdown-text'],
        ['trade-strategy-dropdown-check', 'trade-strategy-dropdown-text'],
    ]);
});

test('previously full-width strategy choices reuse the Return window menu contract', async ({page}) => {
    await page.setViewportSize({width: 1_024, height: 900});
    await page.goto('/workspaces/backtest?range=1y&strategy=leveraged-rotation&show_trade_details=0');
    await page.getByText('Rotation triggers (%, change)', {exact: true}).click();
    const returnWindow = await readChoiceMenuContract(page, 'rotation_window');
    expect(returnWindow).not.toBeNull();

    await page.goto('/workspaces/backtest?range=1y&strategy=supertrend-ai&show_trade_details=0');
    const cluster = await readChoiceMenuContract(page, 'from_cluster');
    expect(cluster).not.toBeNull();

    expect(cluster?.trigger).toEqual(returnWindow?.trigger);
    expect(cluster?.label).toEqual(returnWindow?.label);
    expect(cluster?.geometry.rightDelta).toBeLessThanOrEqual(1);
    expect(cluster?.geometry.labelOverflow).toBeLessThanOrEqual(1);
    expect(cluster?.menu).toEqual(returnWindow?.menu);
    expect(cluster?.option).toEqual(returnWindow?.option);
    expect(cluster?.optionChildren.every((children) => (
        JSON.stringify(children) === JSON.stringify([
            'trade-strategy-dropdown-check',
            'trade-strategy-dropdown-text',
        ])
    ))).toBe(true);
});
