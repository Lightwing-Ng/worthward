/* Code version: v1.0.1 */
import {
    expect,
    test,
    readFile,
    openBacktestParameterOverlay,
    fixturePath,
    requireChipFallback,
    setSidebarExpanded,
    tapAtCenter,
    readPriceLogoThemeAlignment,
    recordCostDistributionGuideStrokes,
    fulfillInertPriceLiveResponse,
    mockInvestmentReadApis,
    assertCompleteStandardInvestmentExportPayload,
} from './support.mjs';
test('uses the compact Apple-style Live trading PIN dialog geometry', async ({page}) => {
    await page.goto('/trade/live-trading');

    const dialog = page.getByRole('dialog', {name: 'Unlock Live trading'});
    const close = dialog.getByRole('link', {name: 'Back to investment'});
    const unlock = dialog.getByRole('button', {name: 'Unlock'});
    await expect(dialog).toBeVisible();
    await expect(close).toBeVisible();
    await expect(dialog.getByRole('link', {name: 'Back', exact: true})).toHaveCount(0);

    const geometry = await dialog.evaluate((element) => {
        const icon = element.querySelector('.live-trading-pin-icon').getBoundingClientRect();
        const title = element.querySelector('.live-trading-pin-title').getBoundingClientRect();
        const button = element.querySelector('.live-trading-pin-button');
        const buttonRect = button.getBoundingClientRect();
        const buttonStyles = getComputedStyle(button);
        const dialogRect = element.getBoundingClientRect();
        return {
            buttonPaddingInline: Number.parseFloat(buttonStyles.paddingInlineStart),
            buttonWidth: buttonRect.width,
            dialogBorderWidth: Number.parseFloat(getComputedStyle(element).borderTopWidth),
            dialogRadius: Number.parseFloat(getComputedStyle(element).borderRadius),
            dialogWidth: dialogRect.width,
            iconCenterY: icon.top + (icon.height / 2),
            iconColor: getComputedStyle(element.querySelector('.live-trading-pin-icon')).backgroundColor,
            titleCenterY: title.top + (title.height / 2),
        };
    });
    expect(Math.abs(geometry.iconCenterY - geometry.titleCenterY)).toBeLessThanOrEqual(0.5);
    expect(geometry.dialogBorderWidth).toBe(1);
    expect(geometry.dialogRadius).toBe(10);
    expect(geometry.dialogWidth).toBeLessThanOrEqual(392);
    expect(geometry.buttonPaddingInline).toBe(14);
    expect(geometry.buttonWidth).toBeLessThan(82);

    const readSlotMarks = () => dialog.locator('.live-trading-pin-slot').evaluateAll((slots) => slots.map((slot) => {
        const slotRect = slot.getBoundingClientRect();
        const mark = getComputedStyle(slot, '::before');
        return {
            centerX: slotRect.left + (slotRect.width / 2),
            centerY: slotRect.top + (slotRect.height / 2),
            height: Number.parseFloat(mark.height),
            color: mark.backgroundColor,
            width: Number.parseFloat(mark.width),
        };
    }));
    const emptyMarks = await readSlotMarks();
    expect(emptyMarks).toHaveLength(6);
    expect(emptyMarks.every((mark) => mark.width === 20 && mark.height === 1)).toBe(true);
    expect(new Set(emptyMarks.map((mark) => mark.centerY)).size).toBe(1);
    const slotIntervals = emptyMarks.slice(1).map((mark, index) => mark.centerX - emptyMarks[index].centerX);
    expect(slotIntervals[0]).toBe(slotIntervals[1]);
    expect(slotIntervals[2]).toBe(slotIntervals[1] + 12);
    expect(slotIntervals[3]).toBe(slotIntervals[1]);
    expect(slotIntervals[4]).toBe(slotIntervals[1]);

    await dialog.locator('#live_trading_pin').fill('123');
    await expect(unlock).toBeDisabled();
    await expect.poll(readSlotMarks).toEqual([
        expect.objectContaining({width: 8, height: 8, color: geometry.iconColor}),
        expect.objectContaining({width: 8, height: 8, color: geometry.iconColor}),
        expect.objectContaining({width: 8, height: 8, color: geometry.iconColor}),
        expect.objectContaining({width: 20, height: 1}),
        expect.objectContaining({width: 20, height: 1}),
        expect.objectContaining({width: 20, height: 1}),
    ]);

    await dialog.locator('#live_trading_pin').fill('1234');
    await expect.poll(readSlotMarks).toEqual([
        expect.objectContaining({width: 8, height: 8, color: geometry.iconColor}),
        expect.objectContaining({width: 8, height: 8, color: geometry.iconColor}),
        expect.objectContaining({width: 8, height: 8, color: geometry.iconColor}),
        expect.objectContaining({width: 8, height: 8, color: geometry.iconColor}),
        expect.objectContaining({width: 20, height: 1}),
        expect.objectContaining({width: 20, height: 1}),
    ]);

    await dialog.locator('#live_trading_pin').fill('123456');
    await expect(unlock).toBeEnabled();
});

test('applies the stored light and dark appearance to the Live trading PIN gate', async ({page}) => {
    await page.goto('/trade/live-trading');
    await page.evaluate(() => {
        window.localStorage.setItem('worthward:theme-mode', 'dark');
    });
    await page.reload();

    const html = page.locator('html');
    const dialog = page.getByRole('dialog', {name: 'Unlock Live trading'});
    await expect(html).toHaveAttribute('data-theme-override', 'dark');
    const darkTheme = await dialog.evaluate((element) => {
        const rootStyles = getComputedStyle(document.documentElement);
        const bodyStyles = getComputedStyle(document.body);
        const titleStyles = getComputedStyle(element.querySelector('.live-trading-pin-title'));
        return {
            bodyBackground: bodyStyles.backgroundColor,
            bodyColor: bodyStyles.color,
            colorScheme: rootStyles.colorScheme,
            themeBackground: rootStyles.getPropertyValue('--theme-background').trim(),
            titleColor: titleStyles.color,
        };
    });
    expect(darkTheme.colorScheme).toBe('dark');
    expect(darkTheme.bodyColor).toBe(darkTheme.titleColor);
    expect(darkTheme.bodyBackground).not.toBe('rgb(255, 255, 255)');

    await page.evaluate(() => {
        window.localStorage.setItem('worthward:theme-mode', 'light');
    });
    await page.reload();
    await expect(html).toHaveAttribute('data-theme-override', 'light');
    const lightTheme = await dialog.evaluate((element) => {
        const rootStyles = getComputedStyle(document.documentElement);
        const bodyStyles = getComputedStyle(document.body);
        return {
            bodyBackground: bodyStyles.backgroundColor,
            colorScheme: rootStyles.colorScheme,
            titleColor: getComputedStyle(element.querySelector('.live-trading-pin-title')).color,
        };
    });
    expect(lightTheme.colorScheme).toBe('light');
    expect(lightTheme.bodyBackground).not.toBe(darkTheme.bodyBackground);
    expect(lightTheme.titleColor).not.toBe(darkTheme.titleColor);
});
